'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { disallowedFiles, loadsProductCode, newlyImplemented, parseLog } = require('../scripts/review-gate.cjs');

test('tests mode only allows tests, .ai, and the review tooling', () => {
  assert.deepEqual(disallowedFiles(['tests/a.test.cjs', '.ai/TRACEABILITY.json', '.ai/sabotage-log.jsonl', 'tests/support/x.cjs'], 'tests'), []);
  assert.deepEqual(disallowedFiles(['electron/main.cjs', 'ui/app.js', 'Blueprint/04_SECURITY_AND_POLICY.md', '.github/workflows/ci.yml', '.ai/ACCEPTANCE.md'], 'tests').sort(),
    ['.ai/ACCEPTANCE.md', '.github/workflows/ci.yml', 'Blueprint/04_SECURITY_AND_POLICY.md', 'electron/main.cjs', 'ui/app.js']);
});

test('fix mode additionally allows electron and ui but never Blueprint, workflows or ACCEPTANCE', () => {
  assert.deepEqual(disallowedFiles(['electron/lib/x.cjs', 'ui/app.js', 'tests/x.test.cjs'], 'fix'), []);
  assert.deepEqual(disallowedFiles(['Blueprint/00_MASTER_BLUEPRINT.md', '.github/workflows/ci.yml', '.ai/ACCEPTANCE.md', 'random.txt'], 'fix').length, 4);
});

test('a test that only mutates local variables is rejected as evidence, a test that loads product code is accepted', () => {
  assert.equal(loadsProductCode("const {test}=require('node:test');const s={a:1};test('x',()=>{s.a=2});"), false);
  assert.equal(loadsProductCode("const {SecurityPolicy}=require('../electron/lib/security-policy.cjs');"), true);
  assert.equal(loadsProductCode("const dp=require('../ui/dashboard-projection.js');"), true);
  assert.equal(loadsProductCode("const { makeRouter } = require('./support/e2e-fixtures.cjs');"), true);
  assert.equal(loadsProductCode("await import('../electron/mcp-server.mjs')"), true);
});

test('only clauses that became IMPLEMENTED are reported as new', () => {
  const before = { items: [{ id: 'A', status: 'PARTIAL' }, { id: 'B', status: 'IMPLEMENTED' }, { id: 'C', status: 'CONFIRMED_GAP' }] };
  const after = { items: [{ id: 'A', status: 'IMPLEMENTED' }, { id: 'B', status: 'IMPLEMENTED' }, { id: 'C', status: 'PARTIAL' }, { id: 'D', status: 'IMPLEMENTED' }] };
  assert.deepEqual(newlyImplemented(before, after).map((item) => item.id), ['A', 'D']);
  assert.deepEqual(newlyImplemented(null, { items: [{ id: 'X', status: 'IMPLEMENTED' }] }).map((item) => item.id), ['X']);
});

test('the sabotage log parser accepts JSON lines and rejects damaged ones', () => {
  assert.equal(parseLog('{"ids":["A"]}\n\n{"ids":["B"]}\n').length, 2);
  assert.equal(parseLog('').length, 0);
  assert.throws(() => parseLog('{"ids":["A"]}\nnot json'), /line 2/);
});
