'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);
const { ControlPlane } = require('../electron/lib/control-plane.cjs');
const { SecurityPolicy, policyReasonCode, policyViolationOf } = require('../electron/lib/security-policy.cjs');
const { runHarness } = require('../electron/lib/harness.cjs');
const projection = require('../ui/dashboard-projection.js');

const root = path.join(__dirname, '..');

async function controlPlane(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aecp-violation-'));
  const cp = new ControlPlane({ rootDir: dir });
  await cp.init();
  t.after(async () => { await cp.shutdown(); await fs.rm(dir, { recursive: true, force: true }); });
  return { cp, dir };
}

const ERROR_SHAPES = {
  denied: () => Object.assign(new Error('x'), { code: 'POLICY_DENIED', policy: { action: 'EXECUTE', reason: 'Path is outside the configured allowlist.' } }),
  approval: () => Object.assign(new Error('x'), { code: 'APPROVAL_REQUIRED', policy: { action: 'PUSH', reason: 'Human approval required by policy.', requiresApproval: true } }),
  ceiling: () => Object.assign(new Error('x'), { code: 'APPROVAL_REQUIRED', policy: { action: 'DELETE', reason: 'Risk exceeds policy ceiling.', requiresApproval: true } }),
  provider: () => Object.assign(new Error('x'), { code: 'APPROVAL_REQUIRED', action: 'NETWORK' })
};

test('B04-RED policyViolationOf maps every policy gate error to an action and a stable reason code', () => {
  assert.deepEqual(policyViolationOf(ERROR_SHAPES.denied()), { action: 'EXECUTE', reasonCode: 'OUTSIDE_ALLOWLIST' });
  assert.deepEqual(policyViolationOf(ERROR_SHAPES.approval()), { action: 'PUSH', reasonCode: 'HUMAN_APPROVAL_REQUIRED' });
  assert.deepEqual(policyViolationOf(ERROR_SHAPES.ceiling()), { action: 'DELETE', reasonCode: 'RISK_CEILING' });
  assert.deepEqual(policyViolationOf(ERROR_SHAPES.provider()), { action: 'NETWORK', reasonCode: 'HUMAN_APPROVAL_REQUIRED' });
  assert.equal(policyReasonCode('something new', false), 'POLICY_DENIED');
  assert.equal(policyReasonCode('something new', true), 'HUMAN_APPROVAL_REQUIRED');
});

test('B04-RED policyViolationOf ignores unrelated errors and never carries a path or message', () => {
  for (const error of [null, undefined, new Error('plain'), Object.assign(new Error('x'), { code: 'ENOENT' }), { code: 'FAILED' }]) {
    assert.equal(policyViolationOf(error), null);
  }
  const violation = policyViolationOf(Object.assign(new Error('C:\\secret\\path leaked'), {
    code: 'POLICY_DENIED', policy: { action: 'WRITE', reason: 'Path is outside the configured allowlist.', path: 'C:\\secret\\path' }
  }));
  assert.deepEqual(Object.keys(violation).sort(), ['action', 'reasonCode']);
  assert.doesNotMatch(JSON.stringify(violation), /secret/);
});

for (const action of ['COMMIT', 'PUSH', 'PR', 'MERGE', 'DELETE', 'INSTALL', 'EXECUTE', 'NETWORK', 'CREDENTIAL', 'SYSTEM']) {
  test(`B04-RED ${action} stopped by policy is recorded as policy.violation without changing the decision`, async (t) => {
    const { cp, dir } = await controlPlane(t);
    const policy = new SecurityPolicy({ allowRoots: [dir], requireApprovalFor: [action] });
    const input = { action, path: dir, approved: false };
    let direct;
    try { policy.assert(input); } catch (error) { direct = error; }
    assert.ok(direct, 'the policy itself stops this action');
    await assert.rejects(() => cp.assertPolicyRecorded(policy, input, { runId: 'R1', taskId: 'T1' }), (error) =>
      error.code === direct.code && error.message === direct.message && JSON.stringify(error.policy) === JSON.stringify(direct.policy));
    const events = (await cp.listEvents()).filter((event) => event.type === 'policy.violation');
    assert.equal(events.length, 1);
    assert.equal(events[0].action, action);
    // RED actions hit the risk ceiling first; the recorded code must be exactly what the policy itself decided.
    assert.equal(events[0].reasonCode, policyReasonCode(direct.policy.reason, direct.policy.requiresApproval));
    assert.ok(['RISK_CEILING', 'HUMAN_APPROVAL_REQUIRED'].includes(events[0].reasonCode));
    assert.equal(events[0].runId, 'R1');
    assert.equal(events[0].taskId, 'T1');
    assert.equal(Object.hasOwn(events[0], 'path'), false);
  });
}

test('B04-RED a path outside the allowlist is recorded as OUTSIDE_ALLOWLIST and an allowed action records nothing', async (t) => {
  const { cp, dir } = await controlPlane(t);
  const policy = new SecurityPolicy({ allowRoots: [dir], requireApprovalFor: [] });
  await assert.rejects(() => cp.assertPolicyRecorded(policy, { action: 'PUSH', path: path.join(os.tmpdir(), 'elsewhere-aecp'), approved: true }, { runId: 'R2', taskId: 'T2' }),
    (error) => error.code === 'POLICY_DENIED');
  const allowed = await cp.assertPolicyRecorded(policy, { action: 'COMMIT', path: dir, approved: true }, { runId: 'R2', taskId: 'T2' });
  assert.equal(allowed.allowed, true);
  const events = (await cp.listEvents()).filter((event) => event.type === 'policy.violation');
  assert.equal(events.length, 1);
  assert.equal(events[0].reasonCode, 'OUTSIDE_ALLOWLIST');
  assert.equal(events[0].action, 'PUSH');
});

test('B04-RED recorded policy violations are classified CRITICAL by the notification projection', () => {
  const list = projection.notifications([{ id: 'evt_1', type: 'policy.violation', at: new Date().toISOString(), runId: 'R1', taskId: 'T1', action: 'PUSH', reasonCode: 'HUMAN_APPROVAL_REQUIRED' }]);
  assert.equal(list.length, 1);
  assert.equal(list[0].category, 'CRITICAL');
  assert.equal(list[0].type, 'policy.violation');
});

async function makeRepo() {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'aecp-violation-harness-'));
  const repo = path.join(base, 'repo');
  const runRoot = path.join(base, 'run');
  await fs.mkdir(repo, { recursive: true });
  await exec('git', ['init'], { cwd: repo });
  await exec('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
  await exec('git', ['config', 'user.name', 'AECP Test'], { cwd: repo });
  await fs.writeFile(path.join(repo, 'package.json'), JSON.stringify({ name: 'v', version: '1.0.0', private: true, scripts: { verify: 'node -e "process.exit(0)"' } }));
  await fs.writeFile(path.join(repo, 'README.md'), 'baseline\n');
  await exec('git', ['add', '.'], { cwd: repo });
  await exec('git', ['commit', '-m', 'base'], { cwd: repo });
  return { base, repo, runRoot };
}

function router() {
  return {
    capabilities(role) { return { process: false, network: false, credential: false, discoversAgentsMd: role === 'builder' }; },
    async execute(role, prompt, opts) {
      if (role === 'planner') return { code: 0, stdout: JSON.stringify({ tasks: [{ task_id: 'T1', title: 't', objective: 'o', acceptance: 'a', dependencies: [], risk: 'GREEN', verifier: 'npm run verify' }] }), stderr: '', timedOut: false, aborted: false };
      if (role === 'builder') { await fs.writeFile(path.join(opts.cwd, 'x.txt'), 'x\n'); return { code: 0, stdout: 'done', stderr: '', timedOut: false, aborted: false }; }
      return { code: 1, stdout: '', stderr: 'reviewer not needed', timedOut: false, aborted: false };
    }
  };
}

test('B04-RED the Harness reports an EXECUTE approval stop as a policy violation and stays HUMAN_REQUIRED', async (t) => {
  const { base, repo, runRoot } = await makeRepo();
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const policy = new SecurityPolicy({ allowRoots: [repo, runRoot, base], requireApprovalFor: ['EXECUTE'] });
  const result = await runHarness({ goal: 'Create a small verified file.', done: 'Verification passes.', sourceRoot: repo, runRoot, workspaceId: 'ws', maxTasks: 1, maxIterations: 1, maxTurns: 6,
    providerRouter: router(), policy, executionApproved: false, plannerProvider: 'p', builderProvider: 'b', reviewerProvider: 'r' });
  assert.equal(result.state, 'HUMAN_REQUIRED');
  assert.deepEqual(result.policyViolation, { action: 'EXECUTE', reasonCode: 'HUMAN_APPROVAL_REQUIRED' });
});

test('B04-RED the Harness reports a path denial as OUTSIDE_ALLOWLIST and fails closed', async (t) => {
  const { base, repo, runRoot } = await makeRepo();
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const policy = new SecurityPolicy({ allowRoots: [path.join(base, 'nowhere')], requireApprovalFor: [] });
  const result = await runHarness({ goal: 'Create a small verified file.', done: 'Verification passes.', sourceRoot: repo, runRoot, workspaceId: 'ws', maxTasks: 1, maxIterations: 1, maxTurns: 6,
    providerRouter: router(), policy, executionApproved: true, plannerProvider: 'p', builderProvider: 'b', reviewerProvider: 'r' });
  assert.equal(result.state, 'FAILED');
  assert.deepEqual(result.policyViolation, { action: 'EXECUTE', reasonCode: 'OUTSIDE_ALLOWLIST' });
});

test('B04-RED the Control Plane records the violation a Harness run reports and main records its preflight denial', () => {
  const cp = fsSync.readFileSync(path.join(root, 'electron', 'lib', 'control-plane.cjs'), 'utf8');
  assert.match(cp, /result\?\.policyViolation\)await this\.recordPolicyViolation\(\{runId:run\.id,taskId:task\.id,\.\.\.result\.policyViolation\}\)/);
  assert.equal([...cp.matchAll(/assertPolicyRecorded\(runPolicy,\{action:'(COMMIT|PUSH|PR)'/g)].length, 3, 'delivery gates go through the recording wrapper');
  const main = fsSync.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
  assert.match(main, /recordPolicyViolation\?\.\(\{ action, reasonCode: policyReasonCode\(check\.reason, false\) \}\)/);
});

test('B04-RED every policy gate call site is accounted for: adding one without deciding how it is recorded fails', () => {
  const expected = {
    'electron/lib/control-plane.cjs': 2, // WRITE check (recorded) and the recording assert wrapper used for delivery
    'electron/lib/harness.cjs': 3, // EXECUTE, NETWORK and CREDENTIAL gates; reported through result.policyViolation
    'electron/lib/windows-ui-adapter.cjs': 1, // SYSTEM gate behind a native confirmation dialog: the operator decision is the record (documented exception)
    'electron/main.cjs': 1 // bounded local execution preflight (recorded through the Control Plane)
  };
  const files = [...fsSync.readdirSync(path.join(root, 'electron', 'lib')).filter((f) => f.endsWith('.cjs')).map((f) => `electron/lib/${f}`), 'electron/main.cjs']
    .filter((f) => !f.endsWith('security-policy.cjs'));
  const actual = {};
  for (const file of files) {
    const count = (fsSync.readFileSync(path.join(root, file), 'utf8').match(/\b(?:this\.)?policy\??\.(?:assert|check)\(/g) || []).length;
    if (count) actual[file] = count;
  }
  assert.deepEqual(actual, expected);
});
