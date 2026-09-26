'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile, spawnSync } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);
const { runHarness, normalizePlan } = require('../electron/lib/harness.cjs');
const { ResourceManager } = require('../electron/lib/resource-manager.cjs');
const { validateAutonomySpec, runBoundedAutonomy } = require('../electron/lib/autonomy.cjs');
const { PythonWorker } = require('../electron/lib/python-worker.cjs');
const { SecurityPolicy } = require('../electron/lib/security-policy.cjs');
const { audit } = require('../electron/lib/adapter-security-audit.cjs');

const ok = (stdout) => ({ code: 0, stdout, stderr: '', timedOut: false, aborted: false });
async function makeRepo(t, name = 'roadmap') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `aecp-${name}-`));
  t.after(async () => fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));
  const repo = path.join(root, 'repo');
  await fs.mkdir(repo, { recursive: true });
  await exec('git', ['init', '-q'], { cwd: repo });
  await exec('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
  await exec('git', ['config', 'user.name', 'AECP Test'], { cwd: repo });
  await fs.writeFile(path.join(repo, 'package.json'), JSON.stringify({ name, version: '1.0.0', private: true, scripts: { verify: 'node -e "process.exit(0)"' } }) + '\n');
  await fs.writeFile(path.join(repo, 'value.txt'), 'original\n');
  await exec('git', ['add', '.'], { cwd: repo });
  await exec('git', ['commit', '-q', '-m', 'base'], { cwd: repo });
  return { root, repo, runRoot: path.join(root, 'run') };
}
const planOf = (count) => ({ tasks: Array.from({ length: count }, (_, i) => ({ task_id: `T${i + 1}`, title: `Task ${i + 1}`, objective: 'Do it.', acceptance: 'Verified.', dependencies: i ? [`T${i}`] : [], risk: 'GREEN', verifier: 'npm run verify' })) });
const review = (prompt, result, extra = {}) => ok(JSON.stringify({ schema: 'aecp.review/v1', task_id: prompt.match(/"task_id":"([^"]+)"/)?.[1] || 'T1', run_id: prompt.match(/"run_id":"([^"]+)"/)?.[1], reviewer: { provider: prompt.match(/"provider":"([^"]+)"/)?.[1], model: 'UNKNOWN' }, result, blueprint: 'PASS', plan: 'PASS', implementation: 'PASS', tests: 'PASS', security: 'PASS', architecture: 'PASS', findings: result === 'REWORK' ? ['fix it'] : [], required_changes: result === 'REWORK' ? ['change the value'] : [], ...extra }));

test('B08-L38 a process that outlives its timeout is killed and reported as timed out, and an abort signal stops it', async () => {
  const { runProcess } = require('../electron/lib/autonomy.cjs');
  const sleeper = ['-e', 'setTimeout(() => console.log("late"), 8000)'];
  const started = Date.now();
  const timed = await runProcess(process.execPath, sleeper, { cwd: os.tmpdir(), timeoutMs: 1000 });
  assert.equal(timed.timedOut, true);
  assert.ok(Date.now() - started < 6000, 'the process was killed, not waited for');
  assert.ok(!timed.stdout.includes('late'));
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 300);
  const abortedAt = Date.now();
  const aborted = await runProcess(process.execPath, sleeper, { cwd: os.tmpdir(), timeoutMs: 60000, signal: controller.signal });
  assert.equal(aborted.aborted, true);
  assert.equal(aborted.timedOut, false);
  assert.ok(Date.now() - abortedAt < 6000);
});

test('B08-L39 stdout and stderr of a process are captured separately and bounded', async () => {
  const { runProcess } = require('../electron/lib/autonomy.cjs');
  const result = await runProcess(process.execPath, ['-e', 'console.log("OUT-LINE"); console.error("ERR-LINE")'], { cwd: os.tmpdir(), timeoutMs: 20000 });
  assert.equal(result.code, 0);
  assert.match(result.stdout, /OUT-LINE/);
  assert.match(result.stderr, /ERR-LINE/);
  assert.ok(!result.stdout.includes('ERR-LINE') && !result.stderr.includes('OUT-LINE'));
  const flood = await runProcess(process.execPath, ['-e', 'process.stdout.write("x".repeat(200000))'], { cwd: os.tmpdir(), timeoutMs: 20000, maxOutputBytes: 1000 });
  assert.equal(flood.outputLimitExceeded, true, 'runaway output is cut off');
  assert.ok(flood.stdout.length <= 1000);
});

test('B08-L54 binding a task to repositories records the resolved paths and their count, and drops empty entries', () => {
  const manager = new ResourceManager(path.join(os.tmpdir(), 'aecp-bind-unused'));
  const task = manager.bindTask({ id: 'T' }, { repositories: ['repo-a', '', null, path.join('x', '..', 'repo-b')] });
  assert.deepEqual(task.resources.repositories, [path.resolve('repo-a'), path.resolve('repo-b')]);
  assert.equal(task.resources.resourceCount, 2);
  assert.deepEqual(manager.bindTask({ id: 'U' }).resources, { repositories: [], resourceCount: 0 });
});

test('B08-L98 only the four documented deterministic verification profiles are accepted', () => {
  const base = { goal: 'Implement the requested feature safely.', done: 'The verifier passes and behavior is present.', workerId: 'opencode' };
  for (const profile of ['npm-verify', 'npm-test', 'pytest', 'unittest']) assert.equal(validateAutonomySpec({ ...base, verificationProfile: profile }).verificationProfile, profile);
  for (const bad of ['', 'rm-rf', 'model-says-pass', 'npm-run-anything']) assert.throws(() => validateAutonomySpec({ ...base, verificationProfile: bad }), /supported deterministic verification profile/);
});

test('B08-L100 a finished autonomous run persists its evidence record, which matches what the run returned', async (t) => {
  const { repo, runRoot } = await makeRepo(t, 'autoev');
  const record = await runBoundedAutonomy({ sourceRoot: repo, runRoot, spec: { goal: 'Change value safely.', done: 'Verifier passes.', workerId: 'opencode', verificationProfile: 'npm-test', maxIterations: 2 } }, {
    workerProbe: async () => '1.18.30',
    runProcess: async (command, args, options) => { if (command === 'opencode') await fs.writeFile(path.join(options.cwd, 'value.txt'), 'changed\n'); return { code: 0, signal: null, timedOut: false, aborted: false, outputLimitExceeded: false, stdout: 'ok', stderr: '' }; },
    runVerification: async () => ({ profile: 'npm-test', label: 'fake', command: 'fake verify', passed: true, code: 0, timedOut: false, aborted: false, stdout: 'PASS', stderr: '' })
  });
  assert.equal(record.state, 'DONE', record.error || '');
  const persisted = JSON.parse(await fs.readFile(path.join(record.runRoot || runRoot, 'run.json'), 'utf8'));
  assert.equal(persisted.state, 'DONE');
  assert.equal(persisted.patchSha256, record.patchSha256);
  assert.match(persisted.patchSha256, /^[a-f0-9]{64}$/);
});

test('B08-L125 a Goal becomes a bounded Plan and Task graph: task count is capped, ids are safe and dependencies are kept', () => {
  const plan = normalizePlan(planOf(20), 'goal text', 'done text', 3);
  assert.equal(plan.tasks.length, 3, 'the graph never exceeds maxTasks');
  assert.deepEqual(plan.tasks.map((task) => task.dependencies), [[], ['T1'], ['T2']], 'the dependency edges survive');
  const unsafe = normalizePlan({ tasks: [{ task_id: '../../etc/passwd', title: 'x', objective: 'y' }] }, 'goal text', 'done text', 4);
  assert.match(unsafe.tasks[0].id, /^[A-Za-z0-9._-]+$/, 'model-supplied ids cannot escape into file names');
});

test('B08-L128 a reviewer REWORK sends the required changes back to the builder and the loop continues until PASS', async (t) => {
  const fixture = await makeRepo(t, 'rework');
  const builderPrompts = [];
  let reviews = 0;
  const router = {
    capabilities: () => ({ process: false, network: false, credential: false, discoversAgentsMd: false }),
    async execute(role, prompt, opts) {
      if (role === 'planner') return ok(JSON.stringify(planOf(1)));
      if (role === 'builder') { builderPrompts.push(prompt); await fs.writeFile(path.join(opts.cwd, 'value.txt'), `attempt ${builderPrompts.length}\n`); return ok('done'); }
      reviews += 1;
      return review(prompt, reviews === 1 ? 'REWORK' : 'PASS');
    }
  };
  const events = [];
  const result = await runHarness({ goal: 'Change the value.', done: 'Verification passes.', sourceRoot: fixture.repo, runRoot: fixture.runRoot, maxTasks: 1, maxIterations: 3, maxTurns: 20, providerRouter: router, plannerProvider: 'p', builderProvider: 'b', reviewerProvider: 'r', onEvent: async (event) => events.push(event.type) });
  assert.equal(result.state, 'DONE');
  assert.equal(builderPrompts.length, 2, 'the builder ran again after REWORK');
  assert.match(builderPrompts[1], /change the value/i, 'the second attempt was given the reviewer required changes');
  assert.ok(events.includes('state.rework'), 'the REWORK state was entered and recorded');
  assert.equal(reviews, 2);
});

test('B08-L128 a reviewer that keeps returning REWORK ends the loop at the iteration budget, never DONE', async (t) => {
  const fixture = await makeRepo(t, 'rework-budget');
  const router = {
    capabilities: () => ({ process: false, network: false, credential: false, discoversAgentsMd: false }),
    async execute(role, prompt, opts) {
      if (role === 'planner') return ok(JSON.stringify(planOf(1)));
      if (role === 'builder') { await fs.writeFile(path.join(opts.cwd, 'value.txt'), `${Date.now()}\n`); return ok('done'); }
      return review(prompt, 'REWORK');
    }
  };
  const result = await runHarness({ goal: 'Change the value.', done: 'Verification passes.', sourceRoot: fixture.repo, runRoot: fixture.runRoot, maxTasks: 1, maxIterations: 2, maxTurns: 20, providerRouter: router, plannerProvider: 'p', builderProvider: 'b', reviewerProvider: 'r' });
  assert.notEqual(result.state, 'DONE');
  assert.ok(['BLOCKED', 'BUDGET_EXHAUSTED'].includes(result.state), result.state);
});

test('B08-L139 the Python worker reports syntax errors as evidence and a non-zero exit, and passes clean code', { skip: spawnSync('python', ['--version'], { encoding: 'utf8' }).status !== 0 }, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aecp-pyw-'));
  t.after(async () => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'good.py'), 'x = 1\n');
  const clean = await new PythonWorker().syntaxScan(root);
  assert.equal(clean.ok, true);
  assert.equal(clean.code, 0);
  await fs.writeFile(path.join(root, 'bad.py'), 'def broken(:\n');
  const broken = await new PythonWorker().syntaxScan(root);
  assert.equal(broken.ok, false);
  assert.equal(broken.code, 2, 'the exit code reflects the errors');
  assert.deepEqual(broken.errors.map((item) => item.file), ['bad.py']);
});

test('B08-L69 the adapter capability matrix is audited: the shipped matrix is clean and an over-permissive adapter is reported', () => {
  const clean = audit();
  assert.equal(clean.ok, true);
  const risky = audit([{ id: 'ollama', kind: 'provider', capabilities: { READ: 'ALLOW', WRITE: 'ALLOW', EXECUTE: 'ALLOW', NETWORK: 'ALLOW', CREDENTIAL: 'ALLOW' } }, { id: 'ollama', kind: 'provider', capabilities: {} }, { kind: 'tool' }]);
  assert.equal(risky.ok, false);
  const types = risky.findings.map((finding) => finding.type);
  assert.ok(types.includes('DUPLICATE_ADAPTER') && types.includes('MISSING_ADAPTER_ID'));
});

test('B08-L73 invoking providers, with or without approvals, never changes the SecurityPolicy that governs them', async (t) => {
  const { invokeRole } = require('../electron/lib/harness.cjs');
  const fixture = await makeRepo(t, 'policy');
  const policy = new SecurityPolicy({ allowRoots: [fixture.root, os.tmpdir()], maxRisk: 'YELLOW' });
  const snapshot = () => JSON.stringify({ roots: policy.allowRoots, maxRisk: policy.maxRisk, approval: [...policy.requireApprovalFor].sort(), net: policy.allowNetworkPaths });
  const before = snapshot();
  for (const capabilities of [{}, { network: true }, { network: true, credential: true }, { process: true }]) {
    const router = { capabilities: () => ({ process: false, network: false, credential: false, ...capabilities }), execute: async () => ok('x') };
    for (const approved of [false, true]) {
      try { await invokeRole({ router, role: 'builder', prompt: 'p', cwd: fixture.repo, policy, providerId: 'any', executionApproved: approved, networkApproved: approved, credentialApproved: approved }); } catch (error) { assert.ok(['APPROVAL_REQUIRED', 'POLICY_DENIED'].includes(error.code), error.message); }
    }
  }
  assert.equal(snapshot(), before, 'switching capabilities/providers and granting approvals left the policy untouched');
  assert.equal(policy.check({ action: 'PUSH' }).allowed, false, 'a RED action is still not allowed afterwards');
});
