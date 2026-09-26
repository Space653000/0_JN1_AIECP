'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { ControlPlane } = require('../electron/lib/control-plane.cjs');
const { makeBase, removeDir, makeRepo, makeRouter } = require('./support/e2e-fixtures.cjs');

async function plane(t) {
  const base = await makeBase('aecp-budget-');
  const repo = await makeRepo(path.join(base, 'workspace'));
  const cp = new ControlPlane({ rootDir: path.join(base, 'runtime'), providerRouter: makeRouter({}) });
  await cp.init();
  t.after(async () => { await cp.shutdown().catch(() => {}); await removeDir(base); });
  const mission = (extra = {}) => cp.createMission({ goal: 'Budget defaults', done: 'Verification passes.', sourceRoot: repo, autoStart: false, maxTasks: 3, maxIterations: 2, providers: { planner: 'plan', builder: 'build', reviewer: 'review' }, ...extra });
  return { mission };
}

test('G15-3 omitted maxTurns and maxFailedAttempts take the documented default formulas, whether undefined or null', async (t) => {
  const { mission } = await plane(t);
  for (const extra of [{}, { maxTurns: undefined, maxFailedAttempts: undefined }, { maxTurns: null, maxFailedAttempts: null }]) {
    const run = await mission(extra);
    assert.equal(run.maxTurns, Math.max(3, 1 + 3 * 2 * 2), JSON.stringify(extra));
    assert.equal(run.maxFailedAttempts, 3 * 2, JSON.stringify(extra));
  }
});

test('G15-3 explicit values are still clamped to the bounds, including zero and negative numbers', async (t) => {
  const { mission } = await plane(t);
  const low = await mission({ maxTurns: 0, maxFailedAttempts: -5 });
  assert.equal(low.maxTurns, 1);
  assert.equal(low.maxFailedAttempts, 1);
  const high = await mission({ maxTurns: 100000, maxFailedAttempts: 100000 });
  assert.equal(high.maxTurns, 200);
  assert.equal(high.maxFailedAttempts, 20);
  const exact = await mission({ maxTurns: 17, maxFailedAttempts: 4 });
  assert.deepEqual([exact.maxTurns, exact.maxFailedAttempts], [17, 4]);
});
