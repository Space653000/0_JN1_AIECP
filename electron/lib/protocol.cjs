'use strict';

const crypto = require('node:crypto');

const COMMAND_SCHEMA = 'aecp.task/v1';
const RESULT_SCHEMA = 'aecp.result/v1';
const MAX_CARD_BYTES = 64 * 1024;
const ACTION_TYPES = ['inspect-workspace', 'git-status'];

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
  if (!ACTION_TYPES.includes(card.action.type)) throw new Error(`Preview build supports: ${ACTION_TYPES.join(', ')}.`);
  if (card.permissions !== undefined && (!Array.isArray(card.permissions) || card.permissions.some((p) => typeof p !== 'string'))) throw new Error('permissions must be an array of strings.');

  return {
    schema: COMMAND_SCHEMA,
    title: card.title.trim(),
    workspace: typeof card.workspace === 'string' ? card.workspace : 'current',
    goal: card.goal.trim(),
    action: { type: card.action.type },
    permissions: Array.isArray(card.permissions) ? [...new Set(card.permissions)] : ['workspace:read'],
    verification: { type: 'operation-success', expected: true }
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

function makeResultCapsule({ taskId, status, summary, durationMs = 0, verification, evidenceRef, facts = [] }) {
  return {
    schema: RESULT_SCHEMA,
    taskId,
    status,
    summary,
    execution: { durationMs },
    verification,
    facts,
    evidenceRef,
    nextDecision: status === 'PASS' ? null : 'Review the local evidence and decide the next step.'
  };
}

function hashJson(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

module.exports = {
  COMMAND_SCHEMA,
  RESULT_SCHEMA,
  ACTION_TYPES,
  MAX_CARD_BYTES,
  extractJsonPayload,
  validateCommandCard,
  parseCommandCard,
  makeTaskId,
  makeResultCapsule,
  hashJson
};
