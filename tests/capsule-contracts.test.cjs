'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ContextBus } = require('../electron/lib/context-bus.cjs');
const {
  makeResultCapsule, RESULT_SCHEMA, MAX_RESULT_FACTS, parseCommandCard, extractJsonPayload,
  withinClipboardWriteLimit, MAX_CARD_BYTES, MAX_CLIPBOARD_WRITE_BYTES, ACTION_TYPES
} = require('../electron/lib/protocol.cjs');

const SECRET = 'sk-abcdefghijklmnop1234';
const BEARER = 'Bearer abcdefghijklmnop1234567890';
const GH = 'ghp_abcdefghijklmnopqrstuvwxyz0123';

async function withBus(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aecp-capsule-'));
  try { const bus = new ContextBus(root); await bus.init(); await fn(bus, root); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test('B11-4-CONTEXT a Context Capsule carries the versioned schema, a bounded redacted payload, an expiry and a matching hash', async () => {
  await withBus(async (bus, root) => {
    const capsule = await bus.write('review-input', { note: `use ${SECRET} and ${BEARER}`, files: ['a.txt'], api_key: 'plain-value-123' });
    assert.equal(capsule.schema, 'aecp.capsule/v1');
    assert.match(capsule.id, /^cap-[0-9a-f]{12}$/);
    assert.equal(capsule.kind, 'review-input');
    assert.ok(Date.parse(capsule.expiresAt) > Date.parse(capsule.createdAt), 'a capsule always expires');
    assert.equal(Date.parse(capsule.expiresAt) - Date.parse(capsule.createdAt) >= 86_000_000, true, 'default TTL is one day');
    const stored = await bus.read(capsule.id);
    assert.deepEqual(stored, JSON.parse(JSON.stringify(capsule)));
    const text = JSON.stringify(stored);
    assert.ok(!text.includes(SECRET) && !text.includes('abcdefghijklmnop1234567890') && !text.includes('plain-value-123'), 'secrets never reach the capsule file');
    assert.equal(stored.payload.files[0], 'a.txt');
    const { sha256, ...unsigned } = stored;
    assert.equal(sha256, crypto.createHash('sha256').update(JSON.stringify(unsigned)).digest('hex'), 'the hash covers the redacted content');
    assert.ok(fs.existsSync(path.join(root, 'capsules', `${capsule.id}.json`)));
  });
});

test('B11-4-CONTEXT an oversized Context Capsule is refused and nothing is written', async () => {
  await withBus(async (bus, root) => {
    await assert.rejects(() => bus.write('big', { blob: 'x'.repeat(200_000) }), /bounded size/);
    await assert.rejects(() => bus.write('small-limit', { blob: 'x'.repeat(500) }, { maxBytes: 300 }), /bounded size/);
    assert.deepEqual(fs.readdirSync(path.join(root, 'capsules')), []);
    const ok = await bus.write('fits', { blob: 'x'.repeat(500) }, { maxBytes: 4096 });
    assert.equal(fs.readdirSync(path.join(root, 'capsules')).length, 1);
    assert.equal(ok.payload.blob.length, 500);
  });
});

test('B11-4-CONTEXT expired Context Capsules are garbage collected and live ones are kept', async () => {
  await withBus(async (bus) => {
    const expired = await bus.write('old', { n: 1 }, { ttlMs: -1000 });
    const live = await bus.write('new', { n: 2 }, { ttlMs: 60_000 });
    assert.equal(await bus.gc(), 1);
    await assert.rejects(() => bus.read(expired.id));
    assert.equal((await bus.read(live.id)).payload.n, 2);
  });
});

test('B11-5-RESULT the Result Capsule has the complete aecp.result/v1 field contract, redacted and bounded', () => {
  const capsule = makeResultCapsule({
    taskId: 'TASK-20260101000000-ABCD', status: 'PASS', summary: `done with ${SECRET}`, durationMs: 1234,
    verification: { status: 'PASS', method: 'operation-success', expected: true, actual: true },
    evidenceRef: 'local://evidence/TASK-20260101000000-ABCD', facts: ['one', `two ${BEARER}`, `three ${GH}`]
  });
  assert.deepEqual(Object.keys(capsule).sort(), ['evidenceRef', 'execution', 'facts', 'nextDecision', 'schema', 'status', 'summary', 'taskId', 'verification']);
  assert.equal(capsule.schema, RESULT_SCHEMA);
  assert.equal(capsule.schema, 'aecp.result/v1');
  assert.equal(capsule.status, 'PASS');
  assert.equal(capsule.nextDecision, null);
  assert.deepEqual(capsule.execution, { durationMs: 1234 });
  assert.deepEqual(capsule.verification, { status: 'PASS', method: 'operation-success', expected: true, actual: true });
  assert.equal(capsule.evidenceRef, 'local://evidence/TASK-20260101000000-ABCD');
  const text = JSON.stringify(capsule);
  for (const secret of [SECRET, 'abcdefghijklmnop1234567890', GH]) assert.ok(!text.includes(secret), `${secret} must be redacted`);
  assert.match(capsule.summary, /\[REDACTED\]/);
});

test('B11-5-RESULT the Result Capsule is bounded: long text is cut, facts are capped and durations are clamped', () => {
  const capsule = makeResultCapsule({
    taskId: 'T'.repeat(500), status: 'PASS', summary: 'S'.repeat(50_000), durationMs: 10 ** 12,
    verification: { status: 'PASS', method: 'M'.repeat(1000), expected: 'e'.repeat(2000), actual: 'a'.repeat(2000) },
    evidenceRef: 'local://' + 'p'.repeat(9000), facts: Array.from({ length: 200 }, (_, i) => `fact-${i}-` + 'F'.repeat(2000))
  });
  assert.equal(capsule.taskId.length, 160);
  assert.equal(capsule.summary.length, 2000);
  assert.equal(capsule.facts.length, MAX_RESULT_FACTS);
  assert.ok(capsule.facts.every((fact) => fact.length <= 500));
  assert.equal(capsule.execution.durationMs, 24 * 60 * 60 * 1000);
  assert.ok(capsule.verification.method.length <= 160 && capsule.verification.expected.length <= 500);
  assert.equal(capsule.evidenceRef.length, 2048);
  assert.ok(Buffer.byteLength(JSON.stringify(capsule)) < 32 * 1024);
  assert.equal(makeResultCapsule({ taskId: 'T', status: 'PASS', summary: 's', durationMs: -5, verification: { status: 'PASS' } }).execution.durationMs, 0);
});

test('B11-5-RESULT a Result Capsule cannot claim success without a passing deterministic verification', () => {
  const claimed = makeResultCapsule({ taskId: 'T', status: 'PASS', summary: 'trust me', verification: { status: 'FAIL', method: 'unit' } });
  assert.equal(claimed.status, 'UNVERIFIED');
  assert.match(claimed.statusNote, /without a passing deterministic verification/);
  assert.match(claimed.nextDecision, /Review the local evidence/);
  assert.equal(makeResultCapsule({ taskId: 'T', status: 'DONE', summary: 's' }).status, 'UNVERIFIED');
  assert.equal(makeResultCapsule({ taskId: 'T', status: 'FAIL', summary: 's', verification: { status: 'FAIL' } }).status, 'FAIL');
});

test('B11-L103 large output never rides in the Result Capsule: raw logs are truncated and artifacts stay behind a local reference', () => {
  const rawLog = Array.from({ length: 5000 }, (_, i) => `line ${i} ${'x'.repeat(80)} token=${GH}`).join('\n');
  const capsule = makeResultCapsule({
    taskId: 'T', status: 'PASS', summary: rawLog, durationMs: 1,
    verification: { status: 'PASS', method: 'operation-success', expected: rawLog, actual: rawLog },
    evidenceRef: 'local://evidence/T', facts: [rawLog, rawLog]
  });
  const bytes = Buffer.byteLength(JSON.stringify(capsule));
  assert.ok(bytes < 12 * 1024, `the capsule stays small (${bytes} bytes) no matter how large the raw log is`);
  assert.ok(!JSON.stringify(capsule).includes(GH));
  assert.match(capsule.evidenceRef, /^local:\/\/evidence\//, 'the large artifact is referenced locally, not embedded');
  assert.ok(withinClipboardWriteLimit(`AECP_RESULT_CAPSULE_V1\n${JSON.stringify(capsule, null, 2)}`), 'a capsule always fits the clipboard limit, so it is never truncated mid-paste');
  assert.equal(withinClipboardWriteLimit('x'.repeat(MAX_CLIPBOARD_WRITE_BYTES + 1)), false);
  assert.equal(withinClipboardWriteLimit('字'.repeat(Math.ceil(MAX_CLIPBOARD_WRITE_BYTES / 3))), false, 'the limit counts UTF-8 bytes, not characters');
  assert.equal(withinClipboardWriteLimit(42), false);
});

test('B11-7-CLIPBOARD the Command Card clipboard framing is accepted in every explicit form and anything else is rejected', () => {
  const card = { schema: 'aecp.task/v1', title: 'Inspect', goal: 'Look at the workspace', action: { type: 'inspect-workspace' }, permissions: ['workspace:read', 'workspace:read'] };
  const json = JSON.stringify(card);
  for (const framed of [json, `AECP_COMMAND_CARD_V1\n${json}`, '```json\n' + json + '\n```', `AECP_COMMAND_CARD_V1\n\`\`\`\n${json}\n\`\`\``, `  \n${json}\n  `]) {
    const parsed = parseCommandCard(framed);
    assert.equal(parsed.title, 'Inspect');
    assert.deepEqual(parsed.action, { type: 'inspect-workspace' });
    assert.deepEqual(parsed.permissions, ['workspace:read'], 'duplicate permissions collapse');
    assert.deepEqual(parsed.verification, { type: 'operation-success', expected: true });
  }
  const invalid = [
    [undefined, /must be text/], [42, /must be text/], ['', /empty/], ['   ', /No JSON object/], ['hello world', /No JSON object/],
    ['{"schema": ', /No JSON object|invalid/], ['{not json}', /invalid/], ['x'.repeat(MAX_CARD_BYTES + 1), /too large/],
    [JSON.stringify({ ...card, schema: 'aecp.task/v2' }), /Unsupported schema/], [JSON.stringify({ ...card, schema: undefined }), /Unsupported schema/],
    [JSON.stringify({ ...card, title: 'x' }), /title is required/], [JSON.stringify({ ...card, goal: 'ab' }), /goal is required/],
    [JSON.stringify({ ...card, action: undefined }), /action is required/], [JSON.stringify({ ...card, action: { type: 'run-shell' } }), /Preview build supports/],
    [JSON.stringify({ ...card, permissions: 'workspace:write' }), /permissions must be an array/], [JSON.stringify({ ...card, permissions: [1] }), /permissions must be an array/]
  ];
  for (const [input, pattern] of invalid) assert.throws(() => parseCommandCard(input), pattern, String(input).slice(0, 40));
  assert.deepEqual(ACTION_TYPES, ['inspect-workspace', 'git-status']);
  assert.throws(() => extractJsonPayload(`AECP_COMMAND_CARD_V1\n`), /No JSON object/);
});
