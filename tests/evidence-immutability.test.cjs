'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { EvidenceManager, writeImmutable, verifyEvidenceRef } = require('../electron/lib/evidence-manager.cjs');
const { normalizePlan } = require('../electron/lib/harness.cjs');

const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aecp-evidence-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const manager = new EvidenceManager(path.join(root, 'evidence'));
  await manager.init();
  return { root, manager };
}

test('B21-10-03 writing different content under an existing name keeps the original and stores a new version', async (t) => {
  const { manager } = await fixture(t);
  const first = await manager.write('run_1', 'T1-result.json', { verdict: 'first' });
  const second = await manager.write('run_1', 'T1-result.json', { verdict: 'second' });
  assert.equal(first.version, 1);
  assert.equal(second.version, 2);
  assert.notEqual(second.file, first.file);
  assert.match(path.basename(second.file), /^T1-result\.v2\.json$/);
  assert.equal(JSON.parse(await fs.readFile(first.file, 'utf8')).verdict, 'first');
  assert.equal(JSON.parse(await fs.readFile(second.file, 'utf8')).verdict, 'second');
  assert.equal((await verifyEvidenceRef(first)).ok, true, 'the original reference still verifies');
  assert.equal((await verifyEvidenceRef(second)).ok, true);
});

test('B21-10-03 writing identical content again is idempotent and creates no new file', async (t) => {
  const { manager } = await fixture(t);
  const first = await manager.write('run_1', 'a.json', { same: true });
  const again = await manager.write('run_1', 'a.json', { same: true });
  assert.equal(again.file, first.file);
  assert.equal(again.version, 1);
  assert.equal(again.sha256, first.sha256);
  assert.deepEqual((await fs.readdir(path.dirname(first.file))).sort(), ['a.json']);
});

test('B21-10-03 concurrent writes with different content never lose or overwrite a version', async (t) => {
  const { manager } = await fixture(t);
  const refs = await Promise.all(['one', 'two', 'three', 'four'].map((value) => manager.write('run_1', 'race.json', { value })));
  assert.equal(new Set(refs.map((ref) => ref.file)).size, 4);
  for (const ref of refs) assert.equal((await verifyEvidenceRef(ref)).ok, true);
  const stored = await Promise.all(refs.map(async (ref) => JSON.parse(await fs.readFile(ref.file, 'utf8')).value));
  assert.deepEqual(stored.sort(), ['four', 'one', 'three', 'two']);
});

test('B21-10-03 verifyEvidence detects tampering, a missing file and a reference outside the evidence root', async (t) => {
  const { root, manager } = await fixture(t);
  const ref = await manager.write('run_1', 'proof.json', { ok: 1 });
  assert.deepEqual((await manager.verify(ref)).reason, 'OK');
  await fs.writeFile(ref.file, '{"ok":2}');
  const tampered = await manager.verify(ref);
  assert.equal(tampered.ok, false);
  assert.equal(tampered.reason, 'HASH_MISMATCH');
  await fs.rm(ref.file);
  assert.equal((await manager.verify(ref)).reason, 'MISSING');
  const outside = path.join(root, 'outside.json');
  await fs.writeFile(outside, 'x');
  assert.equal((await manager.verify({ file: outside, sha256: sha('x') })).reason, 'OUTSIDE_ROOT');
  assert.equal((await manager.verify({ file: outside, sha256: 'nothex' })).reason, 'BAD_REFERENCE');
  assert.equal((await manager.verify(null)).reason, 'BAD_REFERENCE');
});

test('B21-10-03 the manifest verifies every listed item and reports the one that was altered', async (t) => {
  const { manager } = await fixture(t);
  const a = await manager.write('run_1', 'a.json', { a: 1 });
  const b = await manager.write('run_1', 'b.json', { b: 1 });
  const manifest = await manager.manifest('run_1', [{ file: a.file }, { file: b.file }]);
  const good = await manager.verifyManifest(manifest);
  assert.equal(good.ok, true);
  assert.equal(good.items.length, 2);
  await fs.writeFile(b.file, '{"b":999}');
  const bad = await manager.verifyManifest(manifest);
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, 'ITEM_MISMATCH');
  assert.deepEqual(bad.items.filter((item) => !item.ok).map((item) => item.file), [b.file]);
});

test('B21-10-03 model-controlled names cannot write outside the run evidence directory', async (t) => {
  const { root, manager } = await fixture(t);
  const hostile = ['..\\..\\escape.json', '../../escape.json', '..', 'a/b/c.json', 'C:\\Windows\\x.json', '.hidden'];
  for (const name of hostile) {
    const ref = await manager.write('run_1', name, { attempt: name });
    assert.equal(path.dirname(ref.file), manager.runDir('run_1'), `stays in the run directory: ${name}`);
    assert.doesNotMatch(path.basename(ref.file), /[\\/]/);
  }
  const ref = await manager.write('../../elsewhere', 'x.json', { attempt: 'run id' });
  assert.ok(ref.file.startsWith(manager.root + path.sep), 'a hostile run id also stays under the evidence root');
  await assert.rejects(() => fs.stat(path.join(root, 'escape.json')), { code: 'ENOENT' });
  await assert.rejects(() => fs.stat(path.join(root, '..', 'escape.json')), { code: 'ENOENT' });
});

test('B21-10-03 events.jsonl stays append-only and never loses earlier lines', async (t) => {
  const { manager } = await fixture(t);
  await manager.appendEvent('run_1', { n: 1 });
  const second = await manager.appendEvent('run_1', { n: 2 });
  const lines = (await fs.readFile(second.file, 'utf8')).trim().split('\n').map((line) => JSON.parse(line).n);
  assert.deepEqual(lines, [1, 2]);
});

test('B21-10-03 writeImmutable hashes the exact stored bytes', async (t) => {
  const { root } = await fixture(t);
  const ref = await writeImmutable(path.join(root, 'bytes'), 'blob.bin', Buffer.from([0, 255, 1, 2]));
  assert.equal(ref.bytes, 4);
  assert.equal(ref.sha256, crypto.createHash('sha256').update(Buffer.from([0, 255, 1, 2])).digest('hex'));
  assert.equal((await verifyEvidenceRef(ref)).ok, true);
});

test('B21-10-03 planner task ids and dependencies are reduced to a safe character set', () => {
  const plan = normalizePlan({
    tasks: [
      { task_id: '..\\..\\escape', objective: 'first', dependencies: [] },
      { task_id: 'T2 / weird id', objective: 'second', dependencies: ['..\\..\\escape', 'T2 / weird id'] },
      { task_id: 'T3', objective: 'third', dependencies: ['T1'] }
    ]
  }, 'goal', 'done', 8);
  for (const task of plan.tasks) {
    assert.match(task.id, /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/, `safe id: ${task.id}`);
    for (const dependency of task.dependencies) assert.match(dependency, /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/);
  }
  assert.deepEqual(plan.tasks[1].dependencies, [plan.tasks[0].id, plan.tasks[1].id], 'dependencies map to the same sanitized ids');
  assert.equal(plan.tasks[2].id, 'T3');
});
