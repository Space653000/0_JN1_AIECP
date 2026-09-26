'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { loadMain } = require('./support/fake-electron-main.cjs');
const protocol = require('../electron/lib/protocol.cjs');

const { ACTION_TABLE, ACTION_TYPES, parseCommandCard, actionMeta } = protocol;
const ctx = loadMain();
const H = (channel, payload) => ctx.handlers[channel]({}, payload);
const card = (action, extra = {}) => ({ schema: 'aecp.task/v1', title: 'Inspect', goal: 'Perform a read-only inspection', action, permissions: ['workspace:read'], ...extra });
let workspace;

test.before(async () => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'aecp-actiontable-'));
  execFileSync('git', ['init', '-q'], { cwd: workspace });
  fs.writeFileSync(path.join(workspace, 'README.md'), 'table\n');
  await ctx.start();
  ctx.control.chosenFolder = workspace;
  await H('workspace:select');
});
test.after(() => {
  fs.rmSync(workspace, { recursive: true, force: true });
  ctx.dispose();
  setImmediate(() => process.exit(process.exitCode || 0));
});

async function withAction(name, entry, body) {
  ACTION_TABLE[name] = entry;
  try { await body(); } finally { delete ACTION_TABLE[name]; }
}

test('B11-L61 every action in the table has its own schema, a risk class, a verifier and a bounded input size', () => {
  assert.deepEqual(Object.keys(ACTION_TABLE).sort(), ['git-status', 'inspect-workspace']);
  assert.deepEqual([...ACTION_TYPES].sort(), Object.keys(ACTION_TABLE).sort());
  for (const [name, entry] of Object.entries(ACTION_TABLE)) {
    assert.equal(typeof entry.schema, 'object', `${name} schema`);
    assert.ok(['GREEN', 'YELLOW', 'RED'].includes(entry.risk), `${name} risk`);
    assert.equal(typeof entry.verifier, 'string', `${name} verifier`);
    assert.ok(Number.isInteger(entry.maxInputBytes) && entry.maxInputBytes > 0 && entry.maxInputBytes <= 64 * 1024, `${name} maxInputBytes`);
    assert.deepEqual(actionMeta(name), entry);
  }
  assert.equal(actionMeta('delete-everything'), null);
  assert.equal(actionMeta('constructor'), null, 'inherited object keys are not actions');
  assert.equal(actionMeta('__proto__'), null);
});

test('B11-L61 card validation is driven by the table: an action added to the table is understood, one that is not in it is refused', async () => {
  assert.throws(() => parseCommandCard(JSON.stringify(card({ type: 'probe-thing' }))), /supports/);
  await withAction('probe-thing', { schema: { type: 'string', depth: 'number' }, risk: 'GREEN', verifier: 'operation-success', maxInputBytes: 256 }, () => {
    const parsed = parseCommandCard(JSON.stringify(card({ type: 'probe-thing', depth: 2, command: 'rm -rf /', extra: 'dropped' })));
    assert.deepEqual(parsed.action, { type: 'probe-thing', depth: 2 }, 'only fields in the action schema survive; a free-form command does not');
    assert.throws(() => parseCommandCard(JSON.stringify(card({ type: 'probe-thing', depth: 'deep' }))), /depth/, 'a field of the wrong type is refused');
  });
  assert.throws(() => parseCommandCard(JSON.stringify(card({ type: 'probe-thing' }))), /supports/, 'removing it from the table removes it again');
});

test('B11-L61 an action input larger than its table bound is refused', async () => {
  await withAction('bounded-thing', { schema: { type: 'string', label: 'string' }, risk: 'GREEN', verifier: 'operation-success', maxInputBytes: 64 }, () => {
    assert.ok(parseCommandCard(JSON.stringify(card({ type: 'bounded-thing', label: 'short' }))));
    assert.throws(() => parseCommandCard(JSON.stringify(card({ type: 'bounded-thing', label: 'x'.repeat(200) }))), /too large|maximum/i);
  });
});

test('B11-L61 task:import takes the risk and the verifier from the table and ignores what the card claims about itself', async () => {
  for (const claimed of [{ risk: 'RED' }, { risk: 'GREEN', verifier: 'none' }]) {
    const task = await H('task:import', { text: JSON.stringify(card({ type: 'inspect-workspace', ...claimed }, claimed)) });
    assert.equal(task.risk, ACTION_TABLE['inspect-workspace'].risk);
    assert.equal(task.card.verification.type, ACTION_TABLE['inspect-workspace'].verifier);
    assert.deepEqual(task.card.action, { type: 'inspect-workspace' });
  }
  await withAction('probe-yellow', { schema: { type: 'string' }, risk: 'YELLOW', verifier: 'operation-success', maxInputBytes: 128 }, async () => {
    const task = await H('task:import', { text: JSON.stringify(card({ type: 'probe-yellow' }, { risk: 'GREEN' })) });
    assert.equal(task.risk, 'YELLOW', 'the risk comes from the table, so main.cjs is not hard-coding GREEN');
  });
});

test('B11-L61 the verifier that checks an action is the one its table row names', async () => {
  await withAction('verified-thing', { schema: { type: 'string' }, risk: 'GREEN', verifier: 'file-exists', maxInputBytes: 128 }, () => {
    assert.deepEqual(parseCommandCard(JSON.stringify(card({ type: 'verified-thing' }))).verification, { type: 'file-exists', expected: true });
  });
  assert.deepEqual(parseCommandCard(JSON.stringify(card({ type: 'git-status' }))).verification, { type: 'operation-success', expected: true });
});
