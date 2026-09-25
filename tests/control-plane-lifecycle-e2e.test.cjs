'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { ControlPlane } = require('../electron/lib/control-plane.cjs');
const { git, makeBase, removeDir, makeRepo, waitFor, makeRouter, TASK_TERMINAL } = require('./support/e2e-fixtures.cjs');

const PROVIDERS = { planner: 'plan', builder: 'build', reviewer: 'review' };
const spec = (title, extra = {}) => ({ title, objective: `Do ${title}`, acceptance: 'Verification passes.', dependencies: [], risk: 'GREEN', ...extra });

async function boot(t, routerOptions = {}) {
  const base = await makeBase('aecp-lifecycle-');
  const workspace = await makeRepo(path.join(base, 'workspace'));
  const head = await git(workspace, 'rev-parse', 'HEAD');
  const calls = [];
  const router = makeRouter({ ...routerOptions, calls });
  const rootDir = path.join(base, 'runtime');
  const cp = new ControlPlane({ rootDir, providerRouter: router });
  await cp.init();
  cp.lastMaintenanceAt = Date.now();
  t.after(async () => { await cp.shutdown().catch(() => {}); await removeDir(base); });
  return { base, workspace, head, calls, router, cp, rootDir };
}

const newMission = (cp, workspace, extra = {}) => cp.createMission({
  goal: 'Lifecycle mission', done: 'Verification passes.', sourceRoot: workspace, autoStart: false, maxConcurrency: 1,
  maxIterations: 2, maxTurns: 30, maxFailedAttempts: 4, providers: PROVIDERS, ...extra
});

const diskState = async (rootDir) => JSON.parse(await fs.readFile(path.join(rootDir, 'control-plane.json'), 'utf8'));

async function assertWorkspaceUntouched(fx) {
  assert.equal(await git(fx.workspace, 'status', '--porcelain'), '', 'the source Workspace stays clean');
  assert.equal(await git(fx.workspace, 'rev-parse', 'HEAD'), fx.head);
}

test('B20-27-08 the second task starts automatically after the first one really completes, without another manual dispatch', async (t) => {
  const fx = await boot(t, { onBuilder: async (cwd, entry) => fs.writeFile(path.join(cwd, `${entry.title}.txt`), 'work\n') });
  const run = await newMission(fx.cp, fx.workspace);
  const first = await fx.cp.enqueueTask(run, spec('Alpha', { priority: 20 }));
  const second = await fx.cp.enqueueTask(run, spec('Bravo', { priority: 90, dependencies: [first.id] }));

  await fx.cp.schedulerTick();
  assert.equal(second.state, 'QUEUED', 'the higher-priority task waits for its dependency');
  await waitFor(() => first.state === 'DONE' && second.state === 'DONE' && run.state === 'DONE', { label: 'both tasks to complete' });

  const events = await fx.cp.listEvents(2000);
  const index = (type, taskId) => events.findIndex((event) => event.type === type && event.taskId === taskId);
  assert.ok(index('scheduler.selected', first.id) < index('task.finished', first.id));
  assert.ok(index('task.finished', first.id) < index('scheduler.selected', second.id), 'the next task is dispatched only after the first one finished');
  assert.ok(Date.parse(second.startedAt) >= Date.parse(first.finishedAt));
  const builders = fx.calls.filter((call) => call.role === 'builder');
  assert.deepEqual(builders.map((call) => call.title), ['Alpha', 'Bravo']);
  assert.notEqual(builders[0].cwd, builders[1].cwd, 'each task ran in its own worktree');
  await assertWorkspaceUntouched(fx);
});

const SCENARIOS = [
  { name: 'DONE', task: 'DONE', run: 'DONE' },
  { name: 'BLOCKED', task: 'BLOCKED', run: 'BLOCKED', options: { onReviewer: async () => ({ result: 'REWORK', requiredChanges: ['try again'] }) }, builderCalls: 2 },
  { name: 'FAILED', task: 'FAILED', run: 'BLOCKED', options: { onBuilder: async () => { throw new Error('provider process exploded'); } } },
  { name: 'BUDGET_EXHAUSTED', task: 'BUDGET_EXHAUSTED', run: 'BLOCKED', mission: { maxTurns: 1 } },
  { name: 'HUMAN_REQUIRED', task: 'HUMAN_REQUIRED', run: 'HUMAN_REQUIRED', options: { onReviewer: async () => ({ result: 'HUMAN_REQUIRED' }) }, waitingApproval: true }
];

test('R2.1 every terminal state of the bounded state machine is reachable through real execution and is persisted', async (t) => {
  for (const scenario of SCENARIOS) {
    const fx = await boot(t, scenario.options || {});
    const run = await newMission(fx.cp, fx.workspace, scenario.mission || {});
    const task = await fx.cp.enqueueTask(run, spec(`Scenario ${scenario.name}`));
    await fx.cp.schedulerTick();
    await waitFor(() => TASK_TERMINAL.includes(task.state) && run.state !== 'RUNNING', { label: `${scenario.name} to finish` });

    assert.equal(task.state, scenario.task, `${scenario.name}: task state`);
    assert.equal(run.state, scenario.run, `${scenario.name}: mission state`);
    assert.ok(task.attempts <= run.maxIterations, `${scenario.name}: attempts stay within the iteration budget`);
    assert.ok(task.result.providerCalls <= run.maxTurns, `${scenario.name}: provider calls stay within the turn budget`);
    if (scenario.builderCalls) assert.equal(fx.calls.filter((call) => call.role === 'builder').length, scenario.builderCalls, `${scenario.name}: bounded rework`);
    if (scenario.waitingApproval) assert.equal(Object.values(fx.cp.state.approvals).filter((approval) => approval.state === 'WAITING').length, 1);

    // the in-memory state changes a moment before the write to disk completes
    await waitFor(async () => { const disk = await diskState(fx.rootDir); return disk.tasks[task.id]?.state === scenario.task && disk.runs[run.id]?.state === scenario.run; }, { timeoutMs: 15000, label: `${scenario.name} to be persisted` });
    const persisted = await diskState(fx.rootDir);
    assert.equal(persisted.tasks[task.id].state, scenario.task, `${scenario.name}: state is durable`);
    assert.equal(persisted.runs[run.id].state, scenario.run);
    assert.deepEqual(fx.cp.locks.list().filter((lock) => lock.owner === task.id), [], `${scenario.name}: no lock is leaked`);
    await assertWorkspaceUntouched(fx);
  }
});

test('R2.1 cancelling a running mission stops the Worker and ends in CANCELLED without touching the Workspace', async (t) => {
  let running;
  const started = new Promise((resolve) => { running = resolve; });
  const fx = await boot(t, {
    onBuilder: async (_cwd, entry) => {
      running();
      await new Promise((_resolve, reject) => entry.opts.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true }));
    }
  });
  const run = await newMission(fx.cp, fx.workspace);
  const task = await fx.cp.enqueueTask(run, spec('Cancel me'));
  await fx.cp.schedulerTick();
  await started;
  await fx.cp.cancelMission(run.id);
  await waitFor(() => task.state === 'CANCELLED', { label: 'the task to be cancelled' });

  assert.equal(run.state, 'CANCELLED');
  assert.equal((await diskState(fx.rootDir)).tasks[task.id].state, 'CANCELLED');
  await waitFor(() => fx.cp.locks.list().every((lock) => lock.owner !== task.id), { label: 'locks to be released' });
  await assertWorkspaceUntouched(fx);
});

test('R2.1 a human approval returns a HUMAN_REQUIRED task to the queue, the mission resumes by itself and the task completes', async (t) => {
  const fx = await boot(t, { onReviewer: async ({ index }) => (index === 1 ? { result: 'HUMAN_REQUIRED' } : null) });
  const run = await newMission(fx.cp, fx.workspace);
  const task = await fx.cp.enqueueTask(run, spec('Needs a human'));
  await fx.cp.schedulerTick();
  await waitFor(() => task.state === 'HUMAN_REQUIRED' && run.state === 'HUMAN_REQUIRED', { label: 'the human gate' });
  const approval = Object.values(fx.cp.state.approvals).find((entry) => entry.state === 'WAITING');

  await fx.cp.approve(approval.id, { by: 'human', note: 'go ahead' });
  await waitFor(() => task.state === 'DONE' && run.state === 'DONE', { timeoutMs: 60000, label: 'the task to complete after approval' });

  assert.equal(task.error || null, null);
  assert.equal(fx.calls.filter((call) => call.role === 'builder').length, 2, 'the task was really executed again');
  assert.equal(task.attempts, 2);
  const events = await fx.cp.listEvents(2000);
  assert.ok(events.some((event) => event.type === 'approval.approved' && event.runId === run.id && event.resumed === true), 'the approval records that it resumed the mission');
  assert.equal(run.finishedAt !== null, true, 'the mission finishes again once the task is done');
  await assertWorkspaceUntouched(fx);
});

test('R2.1 approving a mission-level NETWORK request starts the mission and never unlocks another mission', async (t) => {
  const fx = await boot(t, {
    caps: { planner: { process: false, network: true } },
    missionTasks: [{ title: 'Only task', objective: 'Do it', acceptance: 'Verification passes.', dependencies: [], risk: 'GREEN' }]
  });
  const otherWorkspace = await makeRepo(path.join(fx.base, 'other-workspace'));
  const common = { done: 'Verification passes.', autoStart: true, maxConcurrency: 1, maxIterations: 2, maxTurns: 30, providers: PROVIDERS };
  const first = await fx.cp.createMission({ ...common, goal: 'Mission ONE goal', sourceRoot: fx.workspace });
  const second = await fx.cp.createMission({ ...common, goal: 'Mission TWO goal', sourceRoot: otherWorkspace });
  assert.deepEqual([first.state, second.state], ['HUMAN_REQUIRED', 'HUMAN_REQUIRED']);
  assert.deepEqual([first.waitingFor, second.waitingFor], ['NETWORK', 'NETWORK']);
  assert.equal(fx.calls.length, 0, 'nothing runs before the human decides');

  const approval = Object.values(fx.cp.state.approvals).find((entry) => entry.runId === first.id && entry.state === 'WAITING');
  await fx.cp.approve(approval.id, { by: 'human' });
  await waitFor(() => first.state === 'DONE', { timeoutMs: 60000, label: 'the approved mission to run to completion' });

  assert.equal(first.providerApprovals.network, true);
  assert.equal(second.providerApprovals.network, false);
  assert.equal(second.state, 'HUMAN_REQUIRED');
  assert.equal(second.waitingFor, 'NETWORK');
  assert.equal(fx.calls.filter((call) => call.prompt.includes('Mission TWO goal')).length, 0, 'no provider ran for the other mission');
  await assertWorkspaceUntouched(fx);
});

test('R2.1 a mission with two tasks waiting for a human only resumes after the last decision', async (t) => {
  const base = await makeBase('aecp-two-gates-');
  const workspace = path.join(base, 'workspace');
  const repoA = await makeRepo(path.join(workspace, 'repo-a'), { name: 'repo-a' });
  const repoB = await makeRepo(path.join(workspace, 'repo-b'), { name: 'repo-b' });
  const calls = [];
  const router = makeRouter({
    calls,
    missionTasks: [
      { title: 'First gate', objective: 'Change A', acceptance: 'Verification passes.', dependencies: [], risk: 'GREEN', repositories: [repoA] },
      { title: 'Second gate', objective: 'Change B', acceptance: 'Verification passes.', dependencies: [], risk: 'GREEN', repositories: [repoB] }
    ],
    onReviewer: async ({ index }) => (index <= 2 ? { result: 'HUMAN_REQUIRED' } : null)
  });
  const cp = new ControlPlane({ rootDir: path.join(base, 'runtime'), providerRouter: router });
  await cp.init();
  cp.lastMaintenanceAt = Date.now();
  t.after(async () => { await cp.shutdown().catch(() => {}); await removeDir(base); });

  const run = await cp.createMission({ goal: 'Two gated changes', done: 'Verification passes.', sourceRoot: workspace, autoStart: true, maxConcurrency: 2, maxIterations: 2, maxTurns: 40, providers: PROVIDERS });
  const tasks = () => run.taskIds.map((id) => cp.state.tasks[id]);
  await waitFor(() => tasks().length === 2 && tasks().every((task) => task.state === 'HUMAN_REQUIRED') && run.state === 'HUMAN_REQUIRED', { label: 'both human gates' });
  const [approvalOne, approvalTwo] = Object.values(cp.state.approvals).filter((entry) => entry.state === 'WAITING');
  assert.ok(approvalOne && approvalTwo);
  const builderCalls = () => calls.filter((call) => call.role === 'builder').length;
  assert.equal(builderCalls(), 2);

  await cp.approve(approvalOne.id, { by: 'human' });
  await new Promise((resolve) => setTimeout(resolve, 2500));
  assert.equal(run.state, 'HUMAN_REQUIRED', 'another decision is still pending, so the mission stays stopped');
  assert.equal(builderCalls(), 2, 'nothing was executed again yet');

  await cp.approve(approvalTwo.id, { by: 'human' });
  await waitFor(() => tasks().every((task) => task.state === 'DONE') && run.state === 'DONE', { timeoutMs: 60000, label: 'both tasks to complete after the last approval' });
  assert.equal(builderCalls(), 4);
  assert.equal(await git(repoA, 'status', '--porcelain'), '');
  assert.equal(await git(repoB, 'status', '--porcelain'), '');
});

test('R5.1 a completed mission, its event history and its evidence survive a process restart intact', async (t) => {
  const fx = await boot(t);
  const run = await newMission(fx.cp, fx.workspace);
  const task = await fx.cp.enqueueTask(run, spec('Durable'));
  await fx.cp.schedulerTick();
  await waitFor(() => task.state === 'DONE' && run.state === 'DONE', { label: 'the mission to complete' });
  await fx.cp.ingestExternalEvent({ externalId: 'ext-1', idempotencyKey: 'github:ext-1', eventType: 'workflow_run', payload: {} });

  const before = { runs: JSON.stringify(fx.cp.state.runs), tasks: JSON.stringify(fx.cp.state.tasks) };
  const eventIds = (await fx.cp.listEvents(5000)).map((event) => event.id);
  const evidenceFiles = [task.evidence.file, task.acceptedEvidence.file, task.evidenceManifest.file, task.result.patch.file, path.join(task.result.runRoot, 'harness.json')];
  const { sha256 } = require('../electron/lib/evidence-manager.cjs');
  const hashes = await Promise.all(evidenceFiles.map((file) => sha256(file)));
  await fx.cp.shutdown();

  const restarted = new ControlPlane({ rootDir: fx.rootDir, providerRouter: fx.router });
  await restarted.init();
  t.after(async () => restarted.shutdown().catch(() => {}));

  assert.equal(JSON.stringify(restarted.state.runs), before.runs, 'missions are identical after restart');
  assert.equal(JSON.stringify(restarted.state.tasks), before.tasks, 'tasks are identical after restart');
  assert.deepEqual((await restarted.listEvents(5000)).map((event) => event.id), eventIds, 'the event history is complete');
  assert.deepEqual(await Promise.all(evidenceFiles.map((file) => sha256(file))), hashes, 'evidence files are byte-identical');
  const manifest = await restarted.evidence.verifyManifest(task.evidenceManifest);
  assert.equal(manifest.ok, true, `manifest verification: ${manifest.reason}`);
  assert.ok(manifest.items.length >= 4);
  const capsule = await restarted.contextBus.read(task.resultCapsule.id);
  assert.equal(capsule.kind, 'result');
  assert.deepEqual([capsule.payload.runId, capsule.payload.taskId, capsule.payload.status], [run.id, task.id, 'PASS']);
  assert.deepEqual(await restarted.ingestExternalEvent({ externalId: 'ext-1', idempotencyKey: 'github:ext-1', eventType: 'workflow_run', payload: {} }), { duplicate: true }, 'replay protection survives the restart');
});

test('R5.1 after a crash in the middle of a task the state, journal and evidence survive and the mission is never blindly replayed', async (t) => {
  let running;
  const started = new Promise((resolve) => { running = resolve; });
  const fx = await boot(t, {
    onBuilder: async (cwd, entry) => {
      await fs.writeFile(path.join(cwd, 'partial.txt'), 'half done');
      running();
      await new Promise((_resolve, reject) => entry.opts.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true }));
    }
  });
  const run = await newMission(fx.cp, fx.workspace);
  const task = await fx.cp.enqueueTask(run, spec('Crash me'));
  await fx.cp.schedulerTick();
  await started;
  await waitFor(async () => (await diskState(fx.rootDir)).tasks[task.id]?.state === 'RUNNING' && (await diskState(fx.rootDir)).tasks[task.id]?.lastEvent, { label: 'the running task to be persisted' });

  // Freeze the first process exactly as a crash would leave the disk.
  const crashed = fx.cp;
  clearInterval(crashed.scheduler);
  crashed.scheduler = null;
  crashed.persist = async () => {};
  crashed.event = async () => ({});
  const journalBefore = (await fx.cp.listEvents(5000)).map((event) => event.type);
  const evidenceEvents = path.join(fx.cp.evidence.root, run.id, 'events.jsonl');
  const evidenceBefore = await fs.readFile(evidenceEvents, 'utf8');

  const resumedCalls = [];
  const restarted = new ControlPlane({ rootDir: fx.rootDir, providerRouter: makeRouter({ calls: resumedCalls }) });
  await restarted.init();
  restarted.lastMaintenanceAt = Date.now();
  t.after(async () => { await restarted.shutdown().catch(() => {}); crashed.shuttingDown = true; for (const controller of crashed.controllers.values()) controller.abort(); await new Promise((resolve) => setTimeout(resolve, 400)); });

  const run2 = restarted.state.runs[run.id];
  const task2 = restarted.state.tasks[task.id];
  assert.equal(run2.state, 'PAUSED');
  assert.equal(run2.recovery.reason, 'process-restart');
  assert.equal(run2.recovery.requiresExplicitResume, true);
  assert.equal(task2.state, 'QUEUED');
  assert.equal(task2.phase, 'RECOVERED');
  assert.equal(task2.resume, true);
  assert.equal(task2.lease, null);
  assert.deepEqual((await restarted.listEvents(5000)).map((event) => event.type).slice(0, journalBefore.length), journalBefore, 'the journal written before the crash is intact');
  assert.equal(await fs.readFile(evidenceEvents, 'utf8'), evidenceBefore, 'the evidence event stream is intact');
  assert.equal(JSON.parse(await fs.readFile(path.join(task.result?.runRoot || path.join(fx.rootDir, 'runs', run.id, task.id), 'harness.json'), 'utf8')).state, 'RUNNING');

  await restarted.schedulerTick();
  await new Promise((resolve) => setTimeout(resolve, 1500));
  assert.equal(resumedCalls.filter((call) => call.role === 'builder').length, 0, 'a recovered mission must not run again until a human resumes it');
  assert.equal(run2.state, 'PAUSED');
});

test.after(() => { setImmediate(() => process.exit(process.exitCode || 0)); });
