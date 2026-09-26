'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { sabotage } = require('../scripts/sabotage-check.cjs');

function fixture(t, { crlf = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aecp-sabotage-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const eol = crlf ? '\r\n' : '\n';
  fs.mkdirSync(path.join(root, 'lib'));
  fs.mkdirSync(path.join(root, 'tests'));
  const source = ['module.exports = { add: (a, b) => a + b, unused: () => 1 };', ''].join(eol);
  fs.writeFileSync(path.join(root, 'lib', 'math.cjs'), source);
  fs.writeFileSync(path.join(root, 'tests', 'strong.test.cjs'),
    "const test=require('node:test');const assert=require('node:assert/strict');const m=require('../lib/math.cjs');\ntest('adds',()=>assert.equal(m.add(2,3),5));\n");
  fs.writeFileSync(path.join(root, 'tests', 'weak.test.cjs'),
    "const test=require('node:test');const assert=require('node:assert/strict');const m=require('../lib/math.cjs');\ntest('exists',()=>assert.equal(typeof m.add,'function'));\n");
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"fixture","private":true}');
  return { root, source, file: path.join(root, 'lib', 'math.cjs') };
}

test('a strong test notices the break and the file is restored byte for byte', (t) => {
  const { root, source, file } = fixture(t);
  const outcome = sabotage({ root, file: 'lib/math.cjs', from: 'a + b', to: 'a - b', tests: ['tests/strong.test.cjs'] });
  assert.equal(outcome.status, 0, outcome.reason);
  assert.equal(fs.readFileSync(file, 'utf8'), source);
});

test('a weak test that still passes is reported as NOT DETECTED', (t) => {
  const { root, source, file } = fixture(t);
  const outcome = sabotage({ root, file: 'lib/math.cjs', from: 'a + b', to: 'a - b', tests: ['tests/weak.test.cjs'] });
  assert.equal(outcome.status, 1, outcome.reason);
  assert.match(outcome.reason, /NOT DETECTED/);
  assert.equal(fs.readFileSync(file, 'utf8'), source);
});

test('text that is missing or ambiguous is refused without touching the file', (t) => {
  const { root, source, file } = fixture(t);
  assert.equal(sabotage({ root, file: 'lib/math.cjs', from: 'does not exist', to: 'x', tests: ['tests/strong.test.cjs'] }).status, 2);
  assert.equal(sabotage({ root, file: 'lib/math.cjs', from: 'a', to: 'x', tests: ['tests/strong.test.cjs'] }).status, 2, 'matches more than once');
  assert.equal(fs.readFileSync(file, 'utf8'), source);
});

test('paths outside the repository and missing files are refused', (t) => {
  const { root } = fixture(t);
  assert.equal(sabotage({ root, file: '../outside.cjs', from: 'a', to: 'b', tests: ['tests/strong.test.cjs'] }).status, 2);
  assert.equal(sabotage({ root, file: 'lib/missing.cjs', from: 'a', to: 'b', tests: ['tests/strong.test.cjs'] }).status, 2);
  assert.equal(sabotage({ root, file: 'lib/math.cjs', from: 'a + b', to: 'a - b', tests: [] }).status, 2);
});

test('CRLF files work with multi-line text and are restored exactly', (t) => {
  const { root, source, file } = fixture(t, { crlf: true });
  const outcome = sabotage({ root, file: 'lib/math.cjs', from: 'add: (a, b) => a + b', to: 'add: (a, b) => 0', tests: ['tests/strong.test.cjs'] });
  assert.equal(outcome.status, 0, outcome.reason);
  assert.equal(fs.readFileSync(file, 'utf8'), source);
});
