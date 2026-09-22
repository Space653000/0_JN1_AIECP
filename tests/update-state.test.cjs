'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createUpdateTransaction, transitionUpdate, reconcileFirstBoot } = require('../electron/lib/update-state.cjs');

test('verified update becomes healthy only when first boot matches target version', () => {
  let tx = createUpdateTransaction({
    currentVersion: '0.3.0',
    targetVersion: '0.4.0',
    targetInstaller: 'target.exe',
    targetSha256: 'abc'
  });
  tx = transitionUpdate(tx, 'INSTALLING');
  tx = reconcileFirstBoot(tx, '0.4.0');
  assert.equal(tx.state, 'HEALTHY');
  assert.equal(tx.observedVersion, '0.4.0');
});

test('mismatched first boot requires rollback', () => {
  let tx = createUpdateTransaction({
    currentVersion: '0.3.0',
    targetVersion: '0.4.0',
    targetInstaller: 'target.exe',
    targetSha256: 'abc',
    rollbackInstaller: 'rollback.exe',
    rollbackSha256: 'def'
  });
  tx = transitionUpdate(tx, 'INSTALLING');
  tx = reconcileFirstBoot(tx, '0.3.0');
  assert.equal(tx.state, 'ROLLBACK_REQUIRED');
  assert.match(tx.reason, /did not match/);
});

test('invalid update transitions are rejected', () => {
  const tx = createUpdateTransaction({
    currentVersion: '0.3.0',
    targetVersion: '0.4.0',
    targetInstaller: 'target.exe',
    targetSha256: 'abc'
  });
  assert.throws(() => transitionUpdate(tx, 'HEALTHY'), /Invalid update transition/);
});
