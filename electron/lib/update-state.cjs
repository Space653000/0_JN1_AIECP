'use strict';

const STATES = Object.freeze([
  'DOWNLOADED',
  'VERIFIED',
  'INSTALLING',
  'FIRST_BOOT_PENDING',
  'HEALTHY',
  'ROLLBACK_REQUIRED',
  'ROLLING_BACK',
  'ROLLED_BACK',
  'FAILED'
]);

const TRANSITIONS = Object.freeze({
  DOWNLOADED: new Set(['VERIFIED','FAILED']),
  VERIFIED: new Set(['INSTALLING','FAILED']),
  INSTALLING: new Set(['FIRST_BOOT_PENDING','ROLLBACK_REQUIRED','FAILED']),
  FIRST_BOOT_PENDING: new Set(['HEALTHY','ROLLBACK_REQUIRED','FAILED']),
  HEALTHY: new Set([]),
  ROLLBACK_REQUIRED: new Set(['ROLLING_BACK','FAILED']),
  ROLLING_BACK: new Set(['ROLLED_BACK','FAILED']),
  ROLLED_BACK: new Set([]),
  FAILED: new Set([])
});

function now(){ return new Date().toISOString(); }

function createUpdateTransaction({ currentVersion, targetVersion, targetInstaller, targetSha256, rollbackInstaller=null, rollbackSha256=null } = {}) {
  if (!currentVersion || !targetVersion || !targetInstaller || !targetSha256) throw new Error('Update transaction requires current/target versions and verified target installer metadata.');
  return {
    schema: 'aecp.update/v1',
    state: 'VERIFIED',
    currentVersion: String(currentVersion),
    targetVersion: String(targetVersion),
    targetInstaller: String(targetInstaller),
    targetSha256: String(targetSha256).toLowerCase(),
    rollbackInstaller: rollbackInstaller ? String(rollbackInstaller) : null,
    rollbackSha256: rollbackSha256 ? String(rollbackSha256).toLowerCase() : null,
    createdAt: now(),
    updatedAt: now(),
    history: [{ state: 'VERIFIED', at: now() }]
  };
}

function transitionUpdate(tx, state, details = {}) {
  if (!tx || !STATES.includes(tx.state)) throw new Error('Invalid update transaction.');
  if (!STATES.includes(state)) throw new Error('Invalid update state.');
  if (!TRANSITIONS[tx.state]?.has(state)) throw new Error(`Invalid update transition: ${tx.state} -> ${state}`);
  const at = now();
  return {
    ...tx,
    ...details,
    state,
    updatedAt: at,
    history: [...(tx.history || []), { state, at, ...details }]
  };
}

function reconcileFirstBoot(tx, runningVersion) {
  if (!tx) return null;
  if (!['INSTALLING','FIRST_BOOT_PENDING'].includes(tx.state)) return tx;
  let next = tx;
  if (next.state === 'INSTALLING') next = transitionUpdate(next, 'FIRST_BOOT_PENDING', { observedVersion: String(runningVersion || '') });
  if (String(runningVersion || '') === String(next.targetVersion)) return transitionUpdate(next, 'HEALTHY', { observedVersion: String(runningVersion) });
  return transitionUpdate(next, 'ROLLBACK_REQUIRED', {
    observedVersion: String(runningVersion || ''),
    reason: 'Installed version did not match the verified update target on first boot.'
  });
}

module.exports = { STATES, TRANSITIONS, createUpdateTransaction, transitionUpdate, reconcileFirstBoot };
