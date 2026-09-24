'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { makeResultCapsule, resultCapsuleStatus, SUCCESS_STATUSES } = require('../electron/lib/protocol.cjs');

const base = { taskId: 'T1', summary: 'done', evidenceRef: 'local://evidence/T1' };

test('B21-10-08 a PASS claim without any verification is downgraded to UNVERIFIED', () => {
  const capsule = makeResultCapsule({ ...base, status: 'PASS' });
  assert.equal(capsule.status, 'UNVERIFIED');
  assert.equal(capsule.verification.status, 'UNKNOWN');
  assert.match(capsule.statusNote, /without a passing deterministic verification/);
  assert.match(capsule.nextDecision, /Review the local evidence/);
});

test('B21-10-08 a PASS claim with a failing or unknown verification is downgraded to UNVERIFIED', () => {
  for (const verification of [{ status: 'FAIL' }, { status: 'UNKNOWN' }, { status: 'PENDING' }, { status: '' }, {}, null, undefined, 'PASS', 42]) {
    const capsule = makeResultCapsule({ ...base, status: 'PASS', verification });
    assert.equal(capsule.status, 'UNVERIFIED', JSON.stringify(verification));
    assert.ok(capsule.statusNote);
  }
});

test('B21-10-08 every success synonym is held to the same rule', () => {
  for (const status of [...SUCCESS_STATUSES, 'pass', ' Success ', 'done']) {
    assert.equal(makeResultCapsule({ ...base, status }).status, 'UNVERIFIED', status);
    const verified = makeResultCapsule({ ...base, status, verification: { status: 'PASS' } });
    assert.notEqual(verified.status, 'UNVERIFIED', `${status} with a passing verification is kept`);
  }
});

test('B21-10-08 PASS is emitted only with a passing verification and then carries no downgrade note', () => {
  const capsule = makeResultCapsule({ ...base, status: 'PASS', verification: { status: 'PASS', method: 'operation-success', expected: true, actual: true } });
  assert.equal(capsule.status, 'PASS');
  assert.equal(capsule.nextDecision, null);
  assert.equal('statusNote' in capsule, false);
  assert.equal(capsule.verification.status, 'PASS');
});

test('B21-10-08 failure statuses are never rewritten to success and never need a verification', () => {
  for (const status of ['FAIL', 'FAILED', 'ERROR', 'BLOCKED', 'HUMAN_REQUIRED']) {
    const capsule = makeResultCapsule({ ...base, status, verification: { status: 'FAIL' } });
    assert.equal(capsule.status, status);
    assert.equal('statusNote' in capsule, false);
  }
});

test('B21-10-08 the Control Plane capsule status is PASS only when the run is DONE and every task verifier passed', () => {
  const passed = { verification: { passed: true } };
  assert.equal(resultCapsuleStatus({ state: 'DONE', tasks: [passed, passed] }), 'PASS');
  assert.equal(resultCapsuleStatus({ state: 'DONE', tasks: [passed, { verification: { passed: false } }] }), 'UNVERIFIED');
  assert.equal(resultCapsuleStatus({ state: 'DONE', tasks: [passed, {}] }), 'UNVERIFIED');
  assert.equal(resultCapsuleStatus({ state: 'DONE', tasks: [] }), 'UNVERIFIED');
  assert.equal(resultCapsuleStatus({ state: 'DONE' }), 'UNVERIFIED');
  assert.equal(resultCapsuleStatus({ state: 'DONE', tasks: [{ verification: { passed: 'true' } }] }), 'UNVERIFIED');
  for (const state of ['FAILED', 'RUNNING', 'HUMAN_REQUIRED', 'BUDGET_EXHAUSTED', undefined]) {
    assert.equal(resultCapsuleStatus({ state, tasks: [passed] }), 'INCOMPLETE', String(state));
  }
  assert.equal(resultCapsuleStatus(null), 'INCOMPLETE');
});

test('B21-10-08 the Control Plane publishes its result capsule with the derived status', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'electron', 'lib', 'control-plane.cjs'), 'utf8');
  assert.match(source, /require\('\.\/protocol\.cjs'\)/);
  assert.match(source, /contextBus\.write\('result',\{[^}]*status:resultCapsuleStatus\(result\)/);
});

test('B21-10-08 the two production capsule call sites pass a real verification object', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  const calls = [...main.matchAll(/makeResultCapsule\(\{[\s\S]*?\}\);/g)].map((m) => m[0]);
  assert.equal(calls.length, 2);
  for (const call of calls) assert.match(call, /verification:\s*\{\s*status:/);
});
