'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const childProcess = require('node:child_process');

const gh = { calls: [], runs: () => [], log: 'FAILED STEP LOG', prCount: 0, prs: new Map() };
const realSpawn = childProcess.spawn;

function fakeChild(stdout, code = 0, stderr = '', delayMs = 0) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => {};
  setTimeout(() => {
    if (stdout) child.stdout.emit('data', Buffer.from(stdout));
    if (stderr) child.stderr.emit('data', Buffer.from(stderr));
    child.emit('close', code);
  }, delayMs);
  return child;
}

// Only the GitHub CLI is faked. git, npm and node all run for real.
childProcess.spawn = function spawnWithFakeGh(command, args, options) {
  if (command !== 'gh') return realSpawn.apply(this, arguments);
  gh.calls.push({ args: [...args], cwd: options?.cwd });
  const flag = (name) => args[args.indexOf(name) + 1];
  if (args[0] === 'pr' && args[1] === 'list') return fakeChild(gh.prs.get(flag('--head')) || '');
  if (args[0] === 'pr' && args[1] === 'create') {
    const url = `https://github.com/acme/app/pull/${++gh.prCount}`;
    gh.prs.set(flag('--head'), url);
    return fakeChild(url);
  }
  if (args[0] === 'run' && args[1] === 'list') return fakeChild(JSON.stringify(gh.runs(flag('--commit'))), 0, '', 1200); // real CI takes far longer than the delivery bookkeeping
  if (args[0] === 'run' && args[1] === 'view') return fakeChild(gh.log);
  if (args[0] === 'pr' && args[1] === 'merge') return fakeChild('merged');
  return fakeChild('');
};

const { ControlPlane } = require('../electron/lib/control-plane.cjs');
const { git, makeBase, removeDir, makeRepo, waitFor, makeRouter } = require('./support/e2e-fixtures.cjs');

const PROVIDERS = { planner: 'plan', builder: 'build', reviewer: 'review' };
const ciRun = (headSha, conclusion, id = 1) => ({ databaseId: id, status: 'completed', conclusion, name: 'AECP CI', url: `https://github.com/acme/app/actions/runs/${id}`, headSha });
const merges = () => gh.calls.filter((call) => call.args[0] === 'pr' && call.args[1] === 'merge');
const pushedRef = (fx, branch) => git(fx.origin, 'rev-parse', `refs/heads/${branch}`);

async function boot(t, { maxIterations = 3 } = {}) {
  gh.calls.length = 0;
  gh.prs.clear();
  gh.prCount = 0;
  gh.log = 'FAILED STEP LOG';
  const base = await makeBase('aecp-delivery-');
  const origin = path.join(base, 'origin.git');
  await fs.mkdir(origin);
  await git(origin, 'init', '-q', '--bare');
  const workspace = await makeRepo(path.join(base, 'workspace'));
  await git(workspace, 'branch', '-M', 'main');
  await git(workspace, 'remote', 'add', 'origin', origin);
  await git(workspace, 'push', '-q', '-u', 'origin', 'main');
  const mainSha = await git(workspace, 'rev-parse', 'HEAD');
  const calls = [];
  const router = makeRouter({ calls, onBuilder: async (cwd, entry) => fs.writeFile(path.join(cwd, `feature-${entry.index}.txt`), `attempt ${entry.index}\n`) });
  const cp = new ControlPlane({ rootDir: path.join(base, 'runtime'), providerRouter: router });
  await cp.init();
  cp.lastMaintenanceAt = Date.now();
  t.after(async () => { await cp.shutdown().catch(() => {}); await removeDir(base); });
  const run = await cp.createMission({
    goal: 'Deliver a governed change', done: 'Verification passes.', sourceRoot: workspace, autoStart: false, maxConcurrency: 1,
    maxIterations, maxTurns: 40, maxFailedAttempts: 6, delivery: true, githubRepo: 'acme/app', providers: PROVIDERS
  });
  const task = await cp.enqueueTask(run, { title: 'Ship it', objective: 'Add a feature file', acceptance: 'Verification passes.', dependencies: [], risk: 'YELLOW' });
  return { base, origin, workspace, mainSha, calls, cp, run, task };
}

const start = async (fx) => { await fx.cp.schedulerTick(); };
const until = async (fx, check, label) => {
  try { return await waitFor(check, { label, timeoutMs: 30000 }); } catch (error) {
    const events = (await fx.cp.listEvents(3000)).map((event) => event.type + (event.error ? ':' + String(event.error).slice(0, 200) : ''));
    throw new Error(`${error.message} :: task=${fx.task.state}/${fx.task.phase} attempts=${fx.task.attempts} error=${fx.task.error} run=${fx.run.state} events=${events.slice(-14).join(',')}`);
  }
};
const eventTypes = async (fx) => (await fx.cp.listEvents(3000));

test('R4.3 a task is delivered on a governed branch with a draft PR and CI is correlated to the pushed commit SHA', async (t) => {
  const fx = await boot(t);
  let otherSha = 'f'.repeat(40);
  gh.runs = (sha) => [ciRun(sha, 'success', 11), ciRun(otherSha, 'failure', 12)];
  await start(fx);
  await until(fx, () => fx.task.ci?.state === 'PASSED', 'CI to pass');

  const branch = `agent/${fx.task.id}`;
  assert.equal(fx.task.delivery.branch, branch);
  assert.equal(await pushedRef(fx, branch), fx.task.delivery.sha, 'the governed branch was really pushed at the task commit');
  assert.equal(await git(fx.origin, 'rev-parse', 'refs/heads/main'), fx.mainSha, 'the default branch is never pushed to');
  assert.equal(await git(fx.origin, 'show', '--name-only', '--format=', fx.task.delivery.sha), 'feature-1.txt');
  assert.equal(await git(fx.workspace, 'status', '--porcelain'), '');
  assert.equal(await git(fx.workspace, 'rev-parse', 'HEAD'), fx.mainSha, 'the source Workspace was not touched');

  const create = gh.calls.find((call) => call.args[1] === 'create').args;
  assert.ok(create.includes('--draft'));
  assert.equal(create[create.indexOf('--head') + 1], branch);
  assert.equal(create[create.indexOf('--base') + 1], 'main');
  assert.equal(create[create.indexOf('--repo') + 1], 'acme/app');
  assert.equal(fx.task.delivery.pr, 'https://github.com/acme/app/pull/1');
  assert.equal(fx.task.delivery.state, 'DRAFT');

  const listed = gh.calls.filter((call) => call.args[0] === 'run' && call.args[1] === 'list');
  assert.ok(listed.length >= 1 && listed.every((call) => call.args[call.args.indexOf('--commit') + 1] === fx.task.delivery.sha), 'CI is always queried by the delivered SHA');
  const events = await eventTypes(fx);
  const at = (type) => events.findIndex((event) => event.type === type && event.taskId === fx.task.id);
  for (const type of ['delivery.pr_created', 'ci.waiting', 'ci.passed', 'approval.requested']) assert.ok(at(type) >= 0, `${type} must be journaled`);
  assert.ok(at('delivery.pr_created') < at('ci.waiting') && at('ci.waiting') < at('ci.passed') && at('ci.passed') < at('approval.requested'));
  for (const type of ['ci.waiting', 'ci.passed']) assert.equal(events[at(type)].sha, fx.task.delivery.sha);
  assert.deepEqual(fx.task.ci.runs.map((entry) => entry.databaseId), [11], 'a failing run of another commit is not attributed to this task');
});

test('R2.7 and R4.6 CI success never merges by itself: the task waits for a human, and the approved merge runs exactly once', async (t) => {
  const fx = await boot(t);
  gh.runs = (sha) => [ciRun(sha, 'success', 21)];
  await start(fx);
  await until(fx, () => fx.task.ci?.state === 'PASSED' && fx.task.state === 'HUMAN_REQUIRED', 'the human gate after CI success');
  await new Promise((resolve) => setTimeout(resolve, 2500));

  assert.equal(fx.task.state, 'HUMAN_REQUIRED');
  assert.equal(fx.run.state, 'HUMAN_REQUIRED');
  assert.equal(fx.task.delivery.state, 'DRAFT');
  assert.equal(merges().length, 0, 'no merge without a human decision, even long after CI passed');
  assert.equal(await git(fx.origin, 'rev-parse', 'refs/heads/main'), fx.mainSha);
  const waiting = Object.values(fx.cp.state.approvals).filter((approval) => approval.taskId === fx.task.id && approval.state === 'WAITING');
  assert.equal(waiting.length, 1);
  assert.match(waiting[0].reason, /CI passed/);

  const merged = await fx.cp.approveDelivery(fx.run.id, fx.task.id, { by: 'reviewer-1', note: 'ship it' });
  assert.equal(merges().length, 1);
  const args = merges()[0].args;
  assert.ok(args.includes('--squash') && args.includes('--delete-branch'));
  assert.equal(args[args.indexOf('--repo') + 1], 'acme/app');
  assert.equal(merged.delivery.state, 'MERGED');
  assert.equal(merged.delivery.mergedBy, 'reviewer-1');
  assert.equal(Object.values(fx.cp.state.approvals).find((approval) => approval.taskId === fx.task.id).state, 'APPROVED');
  await assert.rejects(fx.cp.approveDelivery(fx.run.id, fx.task.id, { by: 'reviewer-1' }), /not awaiting approval/, 'a delivery cannot be merged twice');
  assert.equal(merges().length, 1);
  await until(fx, () => fx.run.state === 'DONE', 'the mission to finish after the merge');
});

test('R4.6 a merge is refused when CI failed, and when the human rejected the approval, even if CI passed', async (t) => {
  const failed = await boot(t);
  gh.log = 'permission denied while pulling the credential';
  gh.runs = (sha) => [ciRun(sha, 'failure', 31)];
  await start(failed);
  await until(failed, () => failed.task.ci?.state === 'FAILED' && failed.task.state === 'BLOCKED', 'CI failure');
  await assert.rejects(failed.cp.approveDelivery(failed.run.id, failed.task.id, { by: 'human' }), /Merge is blocked until required CI passes/);
  assert.equal(merges().length, 0);

  const rejected = await boot(t);
  gh.runs = (sha) => [ciRun(sha, 'success', 41)];
  await start(rejected);
  await until(rejected, () => rejected.task.ci?.state === 'PASSED' && rejected.task.state === 'HUMAN_REQUIRED', 'the approval request');
  const approval = Object.values(rejected.cp.state.approvals).find((entry) => entry.taskId === rejected.task.id && entry.state === 'WAITING');
  await rejected.cp.reject(approval.id, { by: 'human', note: 'not this one' });
  await assert.rejects(rejected.cp.approveDelivery(rejected.run.id, rejected.task.id, { by: 'human' }), /Explicit human approval is required before merge/);
  assert.equal(merges().length, 0);
  assert.equal(rejected.task.state, 'BLOCKED');
  assert.equal(await git(rejected.origin, 'rev-parse', 'refs/heads/main'), rejected.mainSha);
});

test('R4.5 a CI failure that touches credentials or permissions is not reworked automatically', async (t) => {
  const fx = await boot(t);
  gh.log = 'permission denied: authentication failed for the deployment credential';
  gh.runs = (sha) => [ciRun(sha, 'failure', 61)];
  await start(fx);
  await until(fx, () => fx.task.state === 'BLOCKED' && fx.task.ci?.state === 'FAILED', 'the task to be blocked');

  assert.equal(fx.calls.filter((call) => call.role === 'builder').length, 1, 'no automatic rework');
  const events = await eventTypes(fx);
  assert.ok(events.some((event) => event.type === 'ci.failed_max_iterations' && event.taskId === fx.task.id));
  assert.equal(events.some((event) => event.type === 'ci.failed_rework'), false);
  const recovery = JSON.parse(await fs.readFile(path.join(fx.cp.evidence.runDir(fx.run.id), `${fx.task.id}-recovery.json`), 'utf8')).recovery;
  assert.equal(recovery.category, 'HIGH_RISK_OR_AUTH');
  assert.equal(recovery.autoEligible, false);
  assert.equal(await pushedRef(fx, `agent/${fx.task.id}`), fx.task.delivery.sha, 'nothing more was pushed');
  await until(fx, () => fx.run.state === 'BLOCKED', 'the mission to be blocked');
});

test.after(() => { setImmediate(() => process.exit(process.exitCode || 0)); });
