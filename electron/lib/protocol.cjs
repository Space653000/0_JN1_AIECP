'use strict';

const crypto = require('node:crypto');
const { redactText, redactSensitive } = require('./redaction.cjs');

const COMMAND_SCHEMA = 'aecp.task/v1';
const RESULT_SCHEMA = 'aecp.result/v1';
const MAX_CARD_BYTES = 64 * 1024;
const MAX_CLIPBOARD_WRITE_BYTES = 128 * 1024;
const MAX_RESULT_BYTES = 32 * 1024;
const MAX_RESULT_FACTS = 20;
// One row per action: the only place that says which fields an action may carry, how risky it is, how it is verified
// and how large its input may be. Validation (parseCommandCard) and task:import both read this table.
const ACTION_TABLE = {
  'inspect-workspace': Object.freeze({ schema: Object.freeze({ type: 'string' }), risk: 'GREEN', verifier: 'operation-success', maxInputBytes: 1024 }),
  'git-status': Object.freeze({ schema: Object.freeze({ type: 'string' }), risk: 'GREEN', verifier: 'operation-success', maxInputBytes: 1024 })
};
const ACTION_TYPES = Object.freeze(Object.keys(ACTION_TABLE));

function actionMeta(type) {
  return typeof type === 'string' && Object.prototype.hasOwnProperty.call(ACTION_TABLE, type) ? ACTION_TABLE[type] : null;
}

// Keeps only the fields the table allows for this action; a wrong type or an oversized input is refused.
function projectAction(action, meta) {
  const kept = {};
  for (const [field, kind] of Object.entries(meta.schema)) {
    if (action[field] === undefined) continue;
    if (typeof action[field] !== kind) throw new Error(`action.${field} must be a ${kind}.`);
    kept[field] = action[field];
  }
  const size = Buffer.byteLength(JSON.stringify(kept), 'utf8');
  if (size > meta.maxInputBytes) throw new Error(`Action input is too large (${size} bytes; maximum ${meta.maxInputBytes}).`);
  return kept;
}

function extractJsonPayload(input) {
  if (typeof input !== 'string') throw new Error('Clipboard content must be text.');
  const size = Buffer.byteLength(input, 'utf8');
  if (size === 0) throw new Error('Clipboard is empty.');
  if (size > MAX_CARD_BYTES) throw new Error(`Command Card is too large (${size} bytes; maximum ${MAX_CARD_BYTES}).`);

  let text = input.trim();
  if (text.startsWith('AECP_COMMAND_CARD_V1')) text = text.slice('AECP_COMMAND_CARD_V1'.length).trim();
  const fence = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) text = fence[1].trim();

  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first < 0 || last <= first) throw new Error('No JSON object was found in the Command Card.');

  try {
    return JSON.parse(text.slice(first, last + 1));
  } catch (error) {
    throw new Error(`Command Card JSON is invalid: ${error.message}`);
  }
}

function validateCommandCard(card) {
  if (!card || typeof card !== 'object' || Array.isArray(card)) throw new Error('Command Card must be a JSON object.');
  if (card.schema !== COMMAND_SCHEMA) throw new Error(`Unsupported schema. Expected ${COMMAND_SCHEMA}.`);
  if (typeof card.title !== 'string' || card.title.trim().length < 2 || card.title.length > 120) throw new Error('title is required (2–120 characters).');
  if (typeof card.goal !== 'string' || card.goal.trim().length < 3 || card.goal.length > 4000) throw new Error('goal is required (3–4000 characters).');
  if (!card.action || typeof card.action !== 'object') throw new Error('action is required.');
  const meta = actionMeta(card.action.type);
  if (!meta) throw new Error(`Preview build supports: ${Object.keys(ACTION_TABLE).join(', ')}.`);
  const action = projectAction(card.action, meta);
  if (card.permissions !== undefined && (!Array.isArray(card.permissions) || card.permissions.some((p) => typeof p !== 'string'))) throw new Error('permissions must be an array of strings.');

  return {
    schema: COMMAND_SCHEMA,
    title: card.title.trim(),
    workspace: typeof card.workspace === 'string' ? card.workspace : 'current',
    goal: card.goal.trim(),
    action,
    permissions: Array.isArray(card.permissions) ? [...new Set(card.permissions)] : ['workspace:read'],
    verification: { type: meta.verifier, expected: true }
  };
}

function parseCommandCard(text) {
  return validateCommandCard(extractJsonPayload(text));
}

function makeTaskId(now = new Date()) {
  const stamp = now.toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const random = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `TASK-${stamp}-${random}`;
}

function compactScalar(value, max = 500) {
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
  return redactText(String(value)).slice(0, max);
}

function compactVerification(value = {}) {
  const safe = redactSensitive(value && typeof value === 'object' ? value : {});
  return {
    status: compactScalar(safe.status || 'UNKNOWN', 80),
    method: compactScalar(safe.method || 'unspecified', 160),
    expected: ['string','number','boolean'].includes(typeof safe.expected) ? compactScalar(safe.expected, 500) : null,
    actual: ['string','number','boolean'].includes(typeof safe.actual) ? compactScalar(safe.actual, 500) : null
  };
}

// A Result Capsule may only claim success when a deterministic verification passed (Blueprint 21 section 10).
const SUCCESS_STATUSES = new Set(['PASS', 'SUCCESS', 'SUCCEEDED', 'DONE', 'OK', 'COMPLETE', 'COMPLETED']);

function makeResultCapsule({ taskId, status, summary, durationMs = 0, verification, evidenceRef, facts = [] }) {
  const requestedStatus = compactScalar(status, 40);
  const compactedVerification = compactVerification(verification);
  const verified = String(compactedVerification.status).trim().toUpperCase() === 'PASS';
  const claimsSuccess = SUCCESS_STATUSES.has(String(requestedStatus).trim().toUpperCase());
  const downgraded = claimsSuccess && !verified;
  const finalStatus = downgraded ? 'UNVERIFIED' : requestedStatus;
  const capsule = {
    schema: RESULT_SCHEMA,
    taskId: compactScalar(taskId, 160),
    status: finalStatus,
    summary: compactScalar(summary, 2000),
    execution: { durationMs: Math.max(0, Math.min(24 * 60 * 60 * 1000, Number(durationMs) || 0)) },
    verification: compactedVerification,
    facts: (Array.isArray(facts) ? facts : []).slice(0, MAX_RESULT_FACTS).map(item => compactScalar(item, 500)),
    evidenceRef: compactScalar(evidenceRef, 2048),
    nextDecision: finalStatus === 'PASS' ? null : 'Review the local evidence and decide the next step.',
    ...(downgraded ? { statusNote: `Success (${requestedStatus}) was requested without a passing deterministic verification.` } : {})
  };
  const bytes = Buffer.byteLength(JSON.stringify(capsule), 'utf8');
  if (bytes > MAX_RESULT_BYTES) throw new Error(`Result Capsule exceeds the compact payload limit (${bytes} > ${MAX_RESULT_BYTES}).`);
  return capsule;
}

function hashJson(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

// Status for the Control Plane result capsule: PASS only when the harness finished DONE and every task's verifier passed.
function resultCapsuleStatus(result) {
  if (!result || result.state !== 'DONE') return 'INCOMPLETE';
  const tasks = Array.isArray(result.tasks) ? result.tasks : [];
  return tasks.length > 0 && tasks.every((task) => task?.verification?.passed === true) ? 'PASS' : 'UNVERIFIED';
}

// The limit is measured in UTF-8 bytes, so CJK text cannot exceed it while staying under a character count.
function withinClipboardWriteLimit(text) {
  return typeof text === 'string' && Buffer.byteLength(text, 'utf8') <= MAX_CLIPBOARD_WRITE_BYTES;
}

module.exports = {
  COMMAND_SCHEMA,
  RESULT_SCHEMA,
  ACTION_TYPES,
  ACTION_TABLE,
  actionMeta,
  MAX_CARD_BYTES,
  MAX_CLIPBOARD_WRITE_BYTES,
  withinClipboardWriteLimit,
  resultCapsuleStatus,
  SUCCESS_STATUSES,
  MAX_RESULT_BYTES,
  MAX_RESULT_FACTS,
  extractJsonPayload,
  validateCommandCard,
  parseCommandCard,
  makeTaskId,
  makeResultCapsule,
  hashJson
};
