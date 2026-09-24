'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { SecurityPolicy, ACTIONS, RISK } = require('../electron/lib/security-policy.cjs');
const { invokeRole } = require('../electron/lib/harness.cjs');
const { parseCommandCard, ACTION_TYPES } = require('../electron/lib/protocol.cjs');

async function makeRoots(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'aecp-policy-'));
  t.after(async () => fs.rm(base, { recursive: true, force: true }));
  const inside = path.join(base, 'workspace');
  const outside = path.join(base, 'elsewhere');
  await fs.mkdir(inside);
  await fs.mkdir(outside);
  return { inside, outside };
}

function compromisedRouter(capabilities) {
  const calls = [];
  return {
    calls,
    capabilities: () => capabilities,
    execute: async (...args) => { calls.push(args); return { ok: true, text: 'executed' }; }
  };
}

const rejection = (code) => (error) => error.code === code;

test('B04-L11 a compromised provider declaring network or credential capability is stopped by policy before it runs', async (t) => {
  const { inside } = await makeRoots(t);
  const policy = new SecurityPolicy({ allowRoots: [inside] });

  for (const capability of ['network', 'credential']) {
    const router = compromisedRouter({ process: true, [capability]: true });
    await assert.rejects(
      invokeRole({ router, role: 'builder', prompt: 'do anything', cwd: inside, policy }),
      rejection('APPROVAL_REQUIRED'),
      `${capability} must require human approval`
    );
    assert.equal(router.calls.length, 0, `${capability}: provider must not execute without approval`);
  }
});

test('B04-L11 a provider cannot grant itself approval or raise the risk ceiling through its own output', async (t) => {
  const { inside } = await makeRoots(t);
  const policy = new SecurityPolicy({ allowRoots: [inside] });
  const router = compromisedRouter({
    network: true, credential: true, approved: true, networkApproved: true, credentialApproved: true, maxRisk: 'RED', requireApprovalFor: []
  });
  await assert.rejects(invokeRole({ router, role: 'builder', prompt: 'p', cwd: inside, policy }), rejection('APPROVAL_REQUIRED'));
  assert.equal(router.calls.length, 0);
  assert.equal(policy.maxRisk, 'YELLOW');
  assert.equal(policy.requireApprovalFor.has('CREDENTIAL'), true);
});

test('B04-L11 a compromised provider cannot run outside the authorized root even when execution is approved', async (t) => {
  const { inside, outside } = await makeRoots(t);
  const policy = new SecurityPolicy({ allowRoots: [inside] });

  const router = compromisedRouter({ process: true });
  await assert.rejects(
    invokeRole({ router, role: 'builder', prompt: 'p', cwd: outside, policy, executionApproved: true }),
    rejection('POLICY_DENIED')
  );
  const netRouter = compromisedRouter({ network: true });
  await assert.rejects(
    invokeRole({ router: netRouter, role: 'builder', prompt: 'p', cwd: path.join(inside, '..', 'elsewhere'), policy, networkApproved: true }),
    rejection('POLICY_DENIED')
  );
  assert.equal(router.calls.length + netRouter.calls.length, 0);
});

test('B04-L11 the gate is not vacuous: an explicitly approved in-root action does execute', async (t) => {
  const { inside } = await makeRoots(t);
  const policy = new SecurityPolicy({ allowRoots: [inside] });
  const router = compromisedRouter({ process: true, network: true });
  const result = await invokeRole({ router, role: 'builder', prompt: 'p', cwd: inside, policy, executionApproved: true, networkApproved: true });
  assert.equal(result.ok, true);
  assert.equal(router.calls.length, 1);
});

test('B04-L11 every privileged or unknown action a provider might request is refused without explicit approval', async (t) => {
  const { inside, outside } = await makeRoots(t);
  const policy = new SecurityPolicy({ allowRoots: [inside] });

  for (const action of ['SYSTEM', 'CREDENTIAL', 'PUSH', 'MERGE', 'DELETE', 'INSTALL', 'NETWORK']) {
    const verdict = policy.check({ action, path: inside, approved: false, maxRisk: 'RED', requireApprovalFor: [] });
    assert.equal(verdict.allowed, false, `${action} must be refused without approval`);
    assert.equal(verdict.requiresApproval, true, `${action} must ask a human`);
  }
  for (const action of ['ELEVATE', 'SUDO', 'system', ' READ', 'READ ', '', undefined, null, {}]) {
    assert.equal(policy.check({ action, path: inside, approved: true }).allowed, false, `unknown action ${JSON.stringify(action)} must never be allowed`);
  }
  assert.equal(policy.check({ action: 'WRITE', path: outside, approved: true }).allowed, false);
});

test('B04-RED-L70 admin/elevation is not an exposed action and is classified RED and refused even if approved', () => {
  const policy = new SecurityPolicy({ maxRisk: 'RED' });
  for (const action of ['ADMIN', 'ELEVATE', 'SUDO', 'RUNAS', 'RUN_AS_ADMIN']) {
    assert.equal(ACTIONS[action], undefined, `${action} must not be a supported action`);
    assert.equal(policy.classify(action), 'RED');
    const verdict = policy.check({ action, approved: true });
    assert.equal(verdict.allowed, false);
    assert.equal(verdict.reason, 'Unknown action.');
  }
  for (const type of ['run-as-admin', 'elevate', 'sudo', 'runas']) {
    assert.ok(!ACTION_TYPES.includes(type));
    assert.throws(() => parseCommandCard(JSON.stringify({ schema: 'aecp.task/v1', title: 'x1', goal: 'gain admin', action: { type } })), /Preview build supports/);
  }
  assert.equal(RISK.SYSTEM, 'RED');
});

test('B04-RED-L71 payment/billing is not an exposed action and is classified RED and refused even if approved', () => {
  const policy = new SecurityPolicy({ maxRisk: 'RED' });
  for (const action of ['PAYMENT', 'BILLING', 'PURCHASE', 'CHARGE', 'TRANSFER']) {
    assert.equal(ACTIONS[action], undefined, `${action} must not be a supported action`);
    assert.equal(policy.classify(action), 'RED');
    assert.equal(policy.check({ action, approved: true }).allowed, false);
  }
  for (const type of ['payment', 'billing', 'purchase', 'charge-card']) {
    assert.ok(!ACTION_TYPES.includes(type));
    assert.throws(() => parseCommandCard(JSON.stringify({ schema: 'aecp.task/v1', title: 'x1', goal: 'pay money', action: { type } })), /Preview build supports/);
  }
  assert.deepEqual(Object.keys(ACTIONS).sort(), Object.keys(RISK).sort());
});
