'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SecurityPolicy } = require('../electron/lib/security-policy.cjs');
const { isWithinRoot, assertWithinRoot, canonicalForCompare } = require('../electron/lib/path-safety.cjs');

const link = (target, at) => fs.symlinkSync(target, at, process.platform === 'win32' ? 'junction' : 'dir');

function fixture(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'aecp-alias-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const real = path.join(base, 'real');
  const outside = path.join(base, 'outside');
  fs.mkdirSync(path.join(real, 'sub'), { recursive: true });
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(real, 'sub', 'file.txt'), 'inside');
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret');
  const alias = path.join(base, 'alias');
  link(real, alias);
  const escape = path.join(real, 'escape');
  link(outside, escape);
  return { base, real, outside, alias, escape };
}
const allowed = (policy, target) => policy.check({ action: 'READ', path: target }).allowed;

test('G17 a root spelled through a junction/symlink alias accepts the same folder spelled by its real path, and the reverse', (t) => {
  const { real, alias } = fixture(t);
  assert.equal(allowed(new SecurityPolicy({ allowRoots: [alias] }), path.join(real, 'sub', 'file.txt')), true);
  assert.equal(allowed(new SecurityPolicy({ allowRoots: [real] }), path.join(alias, 'sub', 'file.txt')), true);
  assert.equal(isWithinRoot(alias, path.join(real, 'sub')), true);
  assert.equal(isWithinRoot(real, path.join(alias, 'sub')), true);
  assert.doesNotThrow(() => assertWithinRoot(alias, path.join(real, 'sub', 'file.txt')));
});

test('G17 a path that does not exist yet is judged by its nearest existing ancestor, including below an alias', (t) => {
  const { real, alias } = fixture(t);
  assert.equal(allowed(new SecurityPolicy({ allowRoots: [real] }), path.join(alias, 'new', 'deep', 'file.txt')), true);
  assert.equal(allowed(new SecurityPolicy({ allowRoots: [alias] }), path.join(real, 'not-yet', 'file.txt')), true);
  assert.equal(allowed(new SecurityPolicy({ allowRoots: [path.join(real, 'future-root')] }), path.join(alias, 'future-root', 'x.txt')), true);
});

test('G17 nothing is loosened: a path that escapes the root, including through a junction inside it, is still refused', (t) => {
  const { real, outside, alias, escape } = fixture(t);
  for (const root of [real, alias]) {
    const policy = new SecurityPolicy({ allowRoots: [root] });
    assert.equal(allowed(policy, path.join(escape, 'secret.txt')), false, `escape via junction (root ${root === real ? 'real' : 'alias'})`);
    assert.equal(allowed(policy, path.join(alias, 'escape', 'secret.txt')), false, 'escape via alias then junction');
    assert.equal(allowed(policy, path.join(real, '..', 'outside', 'secret.txt')), false, 'plain traversal');
    assert.equal(allowed(policy, path.join(outside, 'secret.txt')), false, 'a sibling folder');
    assert.equal(allowed(policy, path.join(real + '-evil', 'x.txt')), false, 'a folder that only shares the root name prefix');
  }
  assert.equal(isWithinRoot(real, path.join(escape, 'secret.txt')), false);
  assert.throws(() => assertWithinRoot(real, path.join(escape, 'secret.txt')), /outside the active Workspace/);
});

test('G17 canonicalization is idempotent and case-insensitive only where the platform is', (t) => {
  const { real, alias } = fixture(t);
  const once = canonicalForCompare(alias);
  assert.equal(canonicalForCompare(once), once);
  assert.equal(once, canonicalForCompare(real));
  if (process.platform === 'win32') assert.equal(canonicalForCompare(real.toUpperCase()), canonicalForCompare(real.toLowerCase()));
  else assert.notEqual(canonicalForCompare(real.toUpperCase()), canonicalForCompare(real), 'case still matters on case-sensitive systems');
});

test('G17 Windows-style path strings keep being compared textually on any platform', () => {
  assert.equal(isWithinRoot('C:\\Work\\Repo', 'C:\\Work\\Repo\\src\\a.js'), true);
  assert.equal(isWithinRoot('C:\\Work\\Repo', 'C:\\Work\\Other\\a.js'), false);
  assert.equal(isWithinRoot('C:\\Work\\Repo', 'C:\\WORK\\REPO\\src'), true);
});
