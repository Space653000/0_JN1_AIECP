'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);
const { runHarness, DEFAULT_ROLE_PROVIDERS } = require('../electron/lib/harness.cjs');
const { SecurityPolicy } = require('../electron/lib/security-policy.cjs');

const PASS_VERIFY = 'node -e "process.exit(0)"';
const FAIL_VERIFY = 'node -e "process.exit(1)"';
const ok = (stdout) => ({ code: 0, stdout, stderr: '', timedOut: false, aborted: false });

async function makeRepo(t, verify = PASS_VERIFY) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aecp-goal-loop-'));
  t.after(async () => fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));
  const repo = path.join(root, 'repo');
  await fs.mkdir(repo, { recursive: true });
  await exec('git', ['init', '-q'], { cwd: repo });
  await exec('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
  await exec('git', ['config', 'user.name', 'AECP Test'], { cwd: repo });
  await fs.writeFile(path.join(repo, 'package.json'), JSON.stringify({ name: 'goal-loop', version: '1.0.0', private: true, scripts: { verify } }) + '\n');
  await fs.writeFile(path.join(repo, 'README.md'), 'baseline\n');
  await exec('git', ['add', '.'], { cwd: repo });
  await exec('git', ['commit', '-q', '-m', 'base'], { cwd: repo });
  return { root, repo, runRoot: path.join(root, 'run') };
}

// A router that only knows roles and provider ids, like the real ProviderRouter boundary.
function makeRouter({ caps = {}, planner = null, reviewerResult = 'PASS' } = {}) {
  const calls = [];
  return {
    calls,
    capabilities: (role) => ({ process: false, network: false, credential: false, discoversAgentsMd: false, ...(caps[role] || {}) }),
    async execute(role, prompt, opts) {
      calls.push({ role, provider: opts.provider, cwd: opts.cwd });
      if (role === 'planner') return planner ? planner() : ok(JSON.stringify({ tasks: [{ task_id: 'T1', title: 'Change', objective: 'Make the change.', acceptance: 'Verified.', dependencies: [], risk: 'GREEN', verifier: 'npm run verify' }] }));
      if (role === 'builder') { await fs.writeFile(path.join(opts.cwd, 'change.txt'), 'verified change\n'); return ok('builder done'); }
      const runId = prompt.match(/"run_id":"([^"]+)"/)?.[1];
      const provider = prompt.match(/"provider":"([^"]+)"/)?.[1];
      return ok(JSON.stringify({ schema: 'aecp.review/v1', task_id: 'T1', run_id: runId, reviewer: { provider, model: 'UNKNOWN' }, result: reviewerResult, blueprint: 'PASS', plan: 'PASS', implementation: 'PASS', tests: 'PASS', security: 'PASS', architecture: 'PASS', findings: [], required_changes: [] }));
    }
  };
}

const run = (fixture, router, extra = {}) => runHarness({
  goal: 'Make one verified change.', done: 'Verification succeeds.', sourceRoot: fixture.repo, runRoot: fixture.runRoot,
  maxTasks: 1, maxIterations: 2, maxTurns: 12, providerRouter: router, ...extra
});
const keyPaths = (value, prefix = '') => (value && typeof value === 'object' && !Array.isArray(value)
  ? Object.entries(value).flatMap(([key, item]) => (['events', 'checkpoints'].includes(key) ? [`${prefix}${key}`] : keyPaths(item, `${prefix}${key}.`)))
  : Array.isArray(value) ? [prefix.slice(0, -1) + '[]', ...(value.length ? keyPaths(value[0], `${prefix.slice(0, -1)}[].`) : [])] : [prefix.slice(0, -1)]);

test('B14-L263 the Goal Loop takes vendors only from the role configuration: any provider names run the same loop with the same state shape', async (t) => {
  const sets = [
    { plannerProvider: DEFAULT_ROLE_PROVIDERS.planner, builderProvider: DEFAULT_ROLE_PROVIDERS.builder, reviewerProvider: DEFAULT_ROLE_PROVIDERS.reviewer },
    { plannerProvider: 'acme-thinker', builderProvider: 'acme-coder', reviewerProvider: 'acme-critic' },
    { plannerProvider: 'zeta-local', builderProvider: 'zeta-local', reviewerProvider: 'omega-cloud' }
  ];
  const shapes = [];
  for (const set of sets) {
    const fixture = await makeRepo(t);
    const router = makeRouter();
    const result = await run(fixture, router, set);
    assert.equal(result.state, 'DONE', JSON.stringify(set));
    const byRole = Object.fromEntries(router.calls.map((call) => [call.role, call.provider]));
    assert.equal(byRole.planner, set.plannerProvider);
    assert.equal(byRole.builder, set.builderProvider);
    assert.equal(byRole.reviewer, set.reviewerProvider);
    assert.deepEqual([...new Set(router.calls.map((call) => call.role))].sort(), ['builder', 'planner', 'reviewer']);
    const persisted = JSON.parse(await fs.readFile(path.join(fixture.runRoot, 'harness.json'), 'utf8'));
    assert.equal(persisted.state, 'DONE');
    shapes.push(keyPaths(persisted).sort());
  }
  assert.deepEqual(shapes[1], shapes[0], 'inventing new vendor names does not change the persisted loop state');
  assert.deepEqual(shapes[2], shapes[0]);
});

test('B14-L263 changing the vendor of one role for the next run changes nothing but who is called', async (t) => {
  const fixture = await makeRepo(t);
  const first = makeRouter();
  assert.equal((await run(fixture, first, { plannerProvider: 'vendor-a', builderProvider: 'vendor-b', reviewerProvider: 'vendor-c' })).state, 'DONE');
  const otherFixture = await makeRepo(t);
  const second = makeRouter();
  assert.equal((await run(otherFixture, second, { plannerProvider: 'vendor-a', builderProvider: 'vendor-b', reviewerProvider: 'vendor-d' })).state, 'DONE');
  assert.deepEqual(first.calls.map((call) => call.role), second.calls.map((call) => call.role), 'the same sequence of role calls');
  assert.deepEqual(first.calls.filter((call) => call.role !== 'reviewer').map((call) => call.provider), second.calls.filter((call) => call.role !== 'reviewer').map((call) => call.provider));
  assert.equal(first.calls.find((call) => call.role === 'reviewer').provider, 'vendor-c');
  assert.equal(second.calls.find((call) => call.role === 'reviewer').provider, 'vendor-d');
});

test('B14-L438 the Goal Loop is fully autonomous only when every required step is possible: it reaches DONE with all steps and stops at the first missing one', async (t) => {
  // Every required step present: plan, permitted build, deterministic verification, review.
  const good = await makeRepo(t);
  const goodRouter = makeRouter();
  const done = await run(good, goodRouter);
  assert.equal(done.state, 'DONE');
  assert.equal(done.tasks[0].verification.passed, true, 'DONE always carries a passing deterministic verification');

  // No deterministic verification that passes: a friendly reviewer alone can never finish the loop.
  const failing = await makeRepo(t, FAIL_VERIFY);
  const failingResult = await run(failing, makeRouter({ reviewerResult: 'PASS' }));
  assert.notEqual(failingResult.state, 'DONE');
  assert.ok(failingResult.tasks.every((task) => task.verification?.passed !== true));

  // No usable plan: nothing to execute autonomously.
  const noPlan = await makeRepo(t);
  const noPlanRouter = makeRouter({ planner: () => ok('I would rather chat about it.') });
  const noPlanResult = await run(noPlan, noPlanRouter);
  assert.notEqual(noPlanResult.state, 'DONE');
  assert.deepEqual(noPlanRouter.calls.filter((call) => call.role === 'builder'), [], 'without a plan the builder is never started');

  // A reviewer that cannot approve: the loop ends in a human gate or a block, never DONE.
  const humanFixture = await makeRepo(t);
  const humanResult = await run(humanFixture, makeRouter({ reviewerResult: 'HUMAN_REQUIRED' }));
  assert.equal(humanResult.state, 'HUMAN_REQUIRED');
});

test('B14-L438 a provider that needs network or credentials, or a policy without execution rights, stops the loop before anything runs', async (t) => {
  for (const [label, caps, extra, action] of [
    ['network provider without approval', { builder: { network: true } }, {}, 'NETWORK'],
    ['credentialed provider without approval', { builder: { credential: true } }, {}, 'CREDENTIAL'],
    ['process-spawning provider without execution approval', { builder: { process: true } }, {}, 'EXECUTE']
  ]) {
    const fixture = await makeRepo(t);
    const router = makeRouter({ caps });
    const policy = new SecurityPolicy({ allowRoots: [fixture.repo, fixture.root, fixture.runRoot, os.tmpdir()], maxRisk: 'GREEN', requireApprovalFor: ['NETWORK', 'CREDENTIAL', 'EXECUTE'] });
    const result = await run(fixture, router, { policy, ...extra });
    assert.equal(result.state, 'HUMAN_REQUIRED', label);
    assert.equal(result.requiredAction, action, label);
    assert.deepEqual(router.calls.filter((call) => call.role === 'builder'), [], `${label}: the builder was never called`);
    const approved = await makeRepo(t);
    const approvedRouter = makeRouter({ caps });
    const approvedPolicy = new SecurityPolicy({ allowRoots: [approved.repo, approved.root, approved.runRoot, os.tmpdir()], maxRisk: 'RED', requireApprovalFor: ['NETWORK', 'CREDENTIAL', 'EXECUTE'] });
    const approvedResult = await run(approved, approvedRouter, { policy: approvedPolicy, providerNetworkApproved: true, providerCredentialApproved: true, networkApproved: true, credentialApproved: true, executionApproved: true });
    assert.equal(approvedResult.state, 'DONE', `${label}: only explicit approval lets the same loop proceed autonomously`);
  }
});
