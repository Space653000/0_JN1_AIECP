'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);
const { ControlPlane } = require('../electron/lib/control-plane.cjs');

async function makeRepo(base) {
  const repo = path.join(base, 'workspace');
  await fs.mkdir(repo, { recursive: true });
  await exec('git', ['init'], { cwd: repo });
  await exec('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
  await exec('git', ['config', 'user.name', 'AECP Test'], { cwd: repo });
  await fs.writeFile(path.join(repo, 'package.json'), JSON.stringify({ name: 'e2e', version: '1.0.0', private: true, scripts: { verify: 'node -e "process.exit(0)"' } }));
  await fs.writeFile(path.join(repo, 'README.md'), 'baseline\n');
  await exec('git', ['add', '.'], { cwd: repo });
  await exec('git', ['commit', '-m', 'base'], { cwd: repo });
  return repo;
}

function router(onBuilder) {
  const ids = { planner: 'plan', builder: 'build', reviewer: 'review' };
  return {
    resolve: (role, provider) => (ids[role] === provider ? { id: provider } : null),
    capabilities: () => ({ process: false, network: false, credential: false }),
    health: async (provider) => ({ provider, status: 'READY' }),
    async execute(role, prompt, opts) {
      if (role === 'planner') return { code: 0, stdout: JSON.stringify({ tasks: [{ task_id: 'T1', title: 'Write file', objective: 'Create worker-output.txt', acceptance: 'Verification passes.', dependencies: [], risk: 'GREEN', verifier: 'npm run verify' }] }), stderr: '', timedOut: false, aborted: false };
      if (role === 'builder') { await onBuilder(opts.cwd); return { code: 0, stdout: 'builder done', stderr: '', timedOut: false, aborted: false }; }
      if (role === 'reviewer') {
        const runId = prompt.match(/"run_id":"([^"]+)"/)?.[1];
        const taskId = prompt.match(/"task_id":"([^"]+)"/)?.[1];
        const provider = prompt.match(/"provider":"([^"]+)"/)?.[1];
        return { code: 0, stdout: JSON.stringify({ schema: 'aecp.review/v1', task_id: taskId, run_id: runId, reviewer: { provider, model: 'UNKNOWN' }, result: 'PASS', blueprint: 'PASS', plan: 'PASS', implementation: 'PASS', tests: 'PASS', security: 'PASS', architecture: 'PASS', findings: [], required_changes: [] }), stderr: '', timedOut: false, aborted: false };
      }
      throw new Error('unexpected role ' + role);
    }
  };
}

async function waitFor(check, { timeoutMs = 60000, everyMs = 100 } = {}) {
  const started = Date.now();
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() - started > timeoutMs) throw new Error('timed out waiting for the condition');
    await new Promise((resolve) => setTimeout(resolve, everyMs));
  }
}

test('B20-27-02 the Control Plane dispatches a queued task to a Worker in an isolated worktree and completes it without manual copy/paste', async (t) => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'aecp-dispatch-e2e-'));
  const workspace = await makeRepo(base);
  const seen = { cwd: null };
  const cp = new ControlPlane({ rootDir: path.join(base, 'runtime'), providerRouter: router(async (cwd) => { seen.cwd = cwd; await fs.writeFile(path.join(cwd, 'worker-output.txt'), 'made by the worker\n'); }) });
  await cp.init();
  cp.lastMaintenanceAt = Date.now();
  t.after(async () => {
    await cp.shutdown().catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 300));
    await fs.rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
  });

  const run = await cp.createMission({
    goal: 'Create a small verified file.', done: 'Verification passes.', sourceRoot: workspace, autoStart: false, maxConcurrency: 1, maxTurns: 20, maxIterations: 3, maxFailedAttempts: 3, maxTasks: 4,
    providers: { planner: 'plan', builder: 'build', reviewer: 'review' }
  });
  const task = await cp.enqueueTask(run, { title: 'Write file', objective: 'Create worker-output.txt', acceptance: 'Verification passes.', dependencies: [], risk: 'GREEN' });

  await cp.schedulerTick();
  await waitFor(() => ['DONE', 'BLOCKED', 'FAILED', 'HUMAN_REQUIRED', 'BUDGET_EXHAUSTED'].includes(task.state));

  assert.equal(task.error || null, null, 'the task must not fail with an internal error such as a ReferenceError');
  assert.equal(task.state, 'DONE');
  assert.ok(seen.cwd, 'the Builder ran');
  assert.notEqual(path.resolve(seen.cwd), path.resolve(workspace), 'the Worker ran in an isolated worktree, not the source Workspace');
  assert.equal(await fs.stat(path.join(workspace, 'worker-output.txt')).then(() => true, () => false), false, 'the source Workspace was not modified');
  // task.state is set a few milliseconds before task.finished is journaled; wait for the journal instead of racing it.
  await waitFor(async () => (await cp.listEvents()).some((event) => event.type === 'task.finished'), { timeoutMs: 15000 });
  const events = (await cp.listEvents()).map((event) => event.type);
  assert.ok(events.includes('scheduler.selected') && events.includes('task.claimed') && events.includes('task.finished'), events.join(','));
  assert.ok(!events.includes('task.failed'));
});
