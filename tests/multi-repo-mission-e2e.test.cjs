'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { ControlPlane } = require('../electron/lib/control-plane.cjs');
const { canonicalForCompare } = require('../electron/lib/path-safety.cjs');
const { git, makeBase, removeDir, makeRepo, waitFor, makeRouter } = require('./support/e2e-fixtures.cjs');

const PROVIDERS = { planner: 'plan', builder: 'build', reviewer: 'review' };

async function bootWorkspace(t) {
  const base = await makeBase('aecp-multirepo-');
  const workspace = path.join(base, 'workspace');
  await fs.mkdir(path.join(workspace, 'notes'), { recursive: true });
  const repoA = await makeRepo(path.join(workspace, 'repo-a'), { name: 'repo-a' });
  const repoB = await makeRepo(path.join(workspace, 'repo-b'), { name: 'repo-b' });
  const outside = await makeRepo(path.join(base, 'unapproved-repo'), { name: 'unapproved' });
  const heads = { a: await git(repoA, 'rev-parse', 'HEAD'), b: await git(repoB, 'rev-parse', 'HEAD'), outside: await git(outside, 'rev-parse', 'HEAD') };
  const calls = [];
  const router = makeRouter({
    calls,
    missionTasks: [
      { title: 'Task for A', objective: 'Change repository A', acceptance: 'A verified', dependencies: [], risk: 'GREEN', repositories: [repoA] },
      { title: 'Task for B', objective: 'Change repository B', acceptance: 'B verified', dependencies: [], risk: 'GREEN', repositories: [repoB] }
    ],
    onBuilder: async (cwd, entry) => fs.writeFile(path.join(cwd, `${entry.title.replace(/\s+/g, '-')}.txt`), 'work\n')
  });
  const cp = new ControlPlane({ rootDir: path.join(base, 'runtime'), providerRouter: router });
  await cp.init();
  cp.lastMaintenanceAt = Date.now();
  t.after(async () => { await cp.shutdown().catch(() => {}); await removeDir(base); });
  return { base, workspace, repoA, repoB, outside, heads, calls, cp };
}

// Git reports canonical locations; a temp folder reached through an alias (8.3 name, junction) is the same place.
const same = (a, b) => canonicalForCompare(a) === canonicalForCompare(b);

test('R4.1 one Mission discovers the repositories of its approved resources and routes each task to its own repository', async (t) => {
  const fx = await bootWorkspace(t);
  const run = await fx.cp.createMission({
    goal: 'Change two repositories', done: 'Both are verified', sourceRoot: fx.workspace, autoStart: true, maxConcurrency: 2, maxIterations: 2, maxTurns: 40, providers: PROVIDERS
  });
  await waitFor(() => run.state === 'DONE', { timeoutMs: 60000, label: 'the multi-repository mission to finish' });

  assert.deepEqual([...run.repositoryPaths].map((entry) => canonicalForCompare(entry)).sort(), [fx.repoA, fx.repoB].map((entry) => canonicalForCompare(entry)).sort(), 'discovery finds exactly the repositories inside the Workspace');
  const missionPrompt = fx.calls.find((call) => call.kind === 'mission-planner').prompt;
  assert.ok(missionPrompt.includes(fx.repoA) && missionPrompt.includes(fx.repoB), 'the planner is told which repositories are approved');
  assert.ok(!missionPrompt.includes(fx.outside));

  const tasks = run.taskIds.map((id) => fx.cp.state.tasks[id]);
  const taskA = tasks.find((task) => task.title === 'Task for A');
  const taskB = tasks.find((task) => task.title === 'Task for B');
  assert.deepEqual([taskA.state, taskB.state], ['DONE', 'DONE']);
  assert.ok(same(taskA.resources.repositories[0], fx.repoA) && taskA.resources.repositories.length === 1);
  assert.ok(same(taskB.resources.repositories[0], fx.repoB) && taskB.resources.repositories.length === 1);

  for (const [title, repo, other] of [['Task for A', fx.repoA, fx.repoB], ['Task for B', fx.repoB, fx.repoA]]) {
    const call = fx.calls.find((entry) => entry.role === 'builder' && entry.title.endsWith(title));
    assert.ok(call, `${title} was executed`);
    const common = await git(call.cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir');
    assert.ok(same(common, path.join(repo, '.git')), `${title} ran in a worktree of its own repository`);
    assert.ok(!same(common, path.join(other, '.git')));
    assert.ok(call.cwd.includes(`${path.sep}runs${path.sep}`), 'the worktree is task-scoped under the runtime directory');
  }

  for (const [repo, head] of [[fx.repoA, fx.heads.a], [fx.repoB, fx.heads.b]]) {
    assert.equal(await git(repo, 'status', '--porcelain'), '');
    assert.equal(await git(repo, 'rev-parse', 'HEAD'), head, 'source repositories are untouched');
  }
  const worktreesA = await git(fx.repoA, 'worktree', 'list', '--porcelain');
  assert.ok(!worktreesA.includes(taskB.id), 'repository A never hosts the task of repository B');
  const worktrees = fx.calls.filter((entry) => entry.role === 'builder').map((entry) => entry.cwd);
  assert.equal(new Set(worktrees).size, 2, 'each repository got its own worktree');
});

test('R4.1 a task cannot be routed to a repository outside the Mission\'s approved resources', async (t) => {
  const fx = await bootWorkspace(t);
  const run = await fx.cp.createMission({
    goal: 'Change two repositories', done: 'Both are verified', sourceRoot: fx.workspace, autoStart: false, maxConcurrency: 1, providers: PROVIDERS
  });
  await fx.cp.planMission(run);
  assert.equal(run.repositoryPaths.length, 2);

  const spec = { title: 'Sneaky', objective: 'Touch another repository', acceptance: 'x', dependencies: [], risk: 'GREEN' };
  const rerouted = await fx.cp.enqueueTask(run, { ...spec, repositories: [fx.outside] });
  assert.deepEqual(rerouted.resources.repositories.map((entry) => path.resolve(entry)), [path.resolve(run.sourceRoot)], 'an unapproved repository is replaced by the Mission root');
  const mixed = await fx.cp.enqueueTask(run, { ...spec, repositories: [fx.outside, fx.repoB] });
  assert.deepEqual(mixed.resources.repositories.map((entry) => path.resolve(entry).toLowerCase()), [path.resolve(fx.repoB).toLowerCase()]);
  assert.equal(await git(fx.outside, 'rev-parse', 'HEAD'), fx.heads.outside);
  assert.equal(fx.calls.some((call) => call.role === 'builder'), false);
});

test.after(() => { setImmediate(() => process.exit(process.exitCode || 0)); });
