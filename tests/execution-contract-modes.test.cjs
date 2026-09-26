'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { loadMain } = require('./support/fake-electron-main.cjs');
const { ControlPlane } = require('../electron/lib/control-plane.cjs');
const { runHarness } = require('../electron/lib/harness.cjs');
const { validateExecutionContract, updateExecutionContract, makeExecutionContract } = require('../electron/lib/execution-contract.cjs');
const { makeBase, makeRepo, makeRouter, removeDir, waitFor } = require('./support/e2e-fixtures.cjs');

const GOAL = 'Keep the canonical model identical across modes.';
const DONE = 'Every mode carries the same contract fields.';
const ctx = loadMain();
const H = (channel, payload) => ctx.handlers[channel]({}, payload);
const CANONICAL_FIELDS = ['commandCardRef', 'contextCapsuleRef', 'createdAt', 'definitionOfDone', 'evidenceRef', 'goal', 'permissionPolicy', 'resultCapsuleRef', 'schema', 'taskIds', 'traceRef', 'transport', 'updatedAt', 'worker', 'workspace'];
const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aecp-modes-'));
const collected = {};

test.before(async () => {
  execFileSync('git', ['init', '-q'], { cwd: workspaceDir });
  fs.writeFileSync(path.join(workspaceDir, 'README.md'), 'modes\n');
  await ctx.start();
  ctx.control.chosenFolder = workspaceDir;
  await H('workspace:select');
});
test.after(() => {
  fs.rmSync(workspaceDir, { recursive: true, force: true });
  ctx.dispose();
  setImmediate(() => process.exit(process.exitCode || 0));
});

test('B16-L292 Web Safe Bridge: the imported task carries the canonical contract and it survives execution', async () => {
  const card = { schema: 'aecp.task/v1', title: 'Inspect', goal: GOAL, action: { type: 'inspect-workspace' }, permissions: ['workspace:read'] };
  const task = await H('task:import', { text: JSON.stringify(card) });
  const executed = await H('task:execute', { taskId: task.id });
  assert.equal(executed.ok, true);
  collected.web = (await H('task:list')).find((item) => item.id === task.id).executionContract;
  assert.equal(collected.web.transport, 'web-safe-bridge');
  assert.equal(collected.web.goal, GOAL);
  assert.deepEqual(collected.web.taskIds, [task.id]);
  assert.match(collected.web.resultCapsuleRef, /result\.json$/);
  assert.match(collected.web.traceRef, /trace\.jsonl$/);
});

test('B16-L292 Control Plane: a mission and its task carry the canonical contract through a real run', async (t) => {
  const base = await makeBase('aecp-modes-cp-');
  t.after(async () => removeDir(base));
  const repo = await makeRepo(path.join(base, 'workspace'));
  const cp = new ControlPlane({ rootDir: path.join(base, 'runtime'), providerRouter: makeRouter({}) });
  await cp.init();
  cp.lastMaintenanceAt = Date.now();
  t.after(async () => cp.shutdown().catch(() => {}));
  const run = await cp.createMission({ goal: GOAL, done: DONE, sourceRoot: repo, autoStart: false, maxConcurrency: 1, maxIterations: 2, maxTurns: 30, maxFailedAttempts: 4, providers: { planner: 'plan', builder: 'build', reviewer: 'review' } });
  const task = await cp.enqueueTask(run, { title: 'Write', objective: 'Create worker-output.txt', acceptance: DONE, dependencies: [], risk: 'GREEN' });
  await cp.schedulerTick();
  await waitFor(() => task.state === 'DONE', { label: 'the task to finish' });
  collected.mission = run.executionContract;
  collected.task = cp.state.tasks[task.id].executionContract;
  assert.equal(collected.mission.goal, GOAL);
  assert.equal(collected.mission.definitionOfDone, DONE);
  assert.equal(collected.task.goal.startsWith(GOAL), true);
  assert.deepEqual(collected.task.workspace.root, collected.mission.workspace.root, 'the task contract inherits the mission Workspace binding');
});

test('B16-L292 Goal Loop Harness: a run without a supplied contract builds the canonical one', async (t) => {
  const base = await makeBase('aecp-modes-h-');
  t.after(async () => removeDir(base));
  const repo = await makeRepo(path.join(base, 'workspace'));
  const router = makeRouter({});
  const record = await runHarness({ goal: GOAL, done: DONE, sourceRoot: repo, runRoot: path.join(base, 'run'), maxTasks: 1, maxIterations: 2, maxTurns: 12, providerRouter: router, plannerProvider: 'plan', builderProvider: 'build', reviewerProvider: 'review' });
  assert.equal(record.state, 'DONE');
  collected.harness = record.executionContract;
  assert.equal(collected.harness.goal, GOAL);
  assert.equal(collected.harness.definitionOfDone, DONE);
});

test('B16-L292 every mode carries the identical field set and only the transport-specific values differ', async () => {
  assert.deepEqual(Object.keys(collected).sort(), ['harness', 'mission', 'task', 'web']);
  for (const [mode, contract] of Object.entries(collected)) {
    assert.deepEqual(Object.keys(contract).sort(), CANONICAL_FIELDS, `${mode}: the canonical contract fields`);
    assert.equal(contract.schema, 'aecp.execution-contract/v1', mode);
    assert.deepEqual(validateExecutionContract(contract), { ok: true, errors: [] }, mode);
    assert.deepEqual(Object.keys(contract.workspace).sort(), ['id', 'root'], `${mode}: workspace binding`);
    assert.ok(Array.isArray(contract.taskIds), `${mode}: task ids`);
    assert.equal(typeof contract.permissionPolicy, 'object', `${mode}: permission policy`);
    assert.ok(contract.transport, `${mode}: transport`);
    const roundTrip = updateExecutionContract(JSON.parse(JSON.stringify(contract)), { evidenceRef: 'local://evidence/x' });
    assert.deepEqual(Object.keys(roundTrip).sort(), CANONICAL_FIELDS, `${mode}: a round trip through storage and update keeps every field`);
    assert.equal(roundTrip.goal, contract.goal);
    assert.equal(roundTrip.createdAt, contract.createdAt);
  }
  const transports = new Set(Object.values(collected).map((contract) => contract.transport));
  assert.ok(transports.size >= 2, 'the modes really differ in transport');
  assert.deepEqual(validateExecutionContract({}).errors.sort(), ['definitionOfDone', 'goal', 'permissionPolicy', 'schema', 'taskIds', 'transport', 'workspace'], 'a contract missing any canonical part is rejected');
  assert.throws(() => makeExecutionContract({ goal: GOAL }), /Definition of Done/);
  assert.throws(() => makeExecutionContract({ done: DONE }), /goal/);
  assert.deepEqual(Object.keys(makeExecutionContract({ goal: GOAL, done: DONE, workspaceId: 'w' })).sort(), CANONICAL_FIELDS, 'even a minimal contract has every canonical field');
  void fsp;
});
