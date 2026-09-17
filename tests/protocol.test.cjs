'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  COMMAND_SCHEMA,
  parseCommandCard,
  validateCommandCard,
  makeTaskId,
  makeResultCapsule
} = require('../electron/lib/protocol.cjs');

test('parses a framed inspect-workspace Command Card', () => {
  const input = `AECP_COMMAND_CARD_V1\n${JSON.stringify({
    schema: COMMAND_SCHEMA,
    title: 'Inspect Workspace',
    goal: 'Read local Workspace metadata only.',
    action: { type: 'inspect-workspace' },
    permissions: ['workspace:read']
  })}`;
  const card = parseCommandCard(input);
  assert.equal(card.action.type, 'inspect-workspace');
  assert.equal(card.workspace, 'current');
});

test('parses fenced JSON', () => {
  const input = '```json\n' + JSON.stringify({
    schema: COMMAND_SCHEMA,
    title: 'Git status',
    goal: 'Read repository status.',
    action: { type: 'git-status' }
  }) + '\n```';
  const card = parseCommandCard(input);
  assert.equal(card.action.type, 'git-status');
});

test('rejects unsupported action capabilities', () => {
  assert.throws(() => validateCommandCard({
    schema: COMMAND_SCHEMA,
    title: 'Unsafe action',
    goal: 'Try an unsupported capability.',
    action: { type: 'shell' }
  }), /Preview build supports/);
});

test('rejects unsupported schema', () => {
  assert.throws(() => validateCommandCard({
    schema: 'aecp.task/v999',
    title: 'Bad schema',
    goal: 'Validate version handling.',
    action: { type: 'inspect-workspace' }
  }), /Unsupported schema/);
});

test('task IDs are namespaced and non-empty', () => {
  assert.match(makeTaskId(new Date('2026-09-17T12:00:00Z')), /^TASK-\d{14}-[A-F0-9]{4}$/);
});

test('Result Capsule is compact and versioned', () => {
  const result = makeResultCapsule({
    taskId: 'TASK-1',
    status: 'PASS',
    summary: 'ok',
    durationMs: 42,
    verification: { status: 'PASS' },
    evidenceRef: 'local://evidence/TASK-1',
    facts: ['one']
  });
  assert.equal(result.schema, 'aecp.result/v1');
  assert.equal(result.status, 'PASS');
  assert.equal(result.nextDecision, null);
});
