'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { safeJson, normalizePlan, STATES } = require('../electron/lib/harness.cjs');

test('Harness exposes bounded state machine states', () => {
  assert.ok(STATES.includes('PLANNING'));
  assert.ok(STATES.includes('REVIEWING'));
  assert.ok(STATES.includes('HUMAN_REQUIRED'));
  assert.ok(STATES.includes('DONE'));
});

test('Planner JSON parser accepts fenced JSON', () => {
  const value = safeJson('```json\n{"tasks":[{"task_id":"T1","objective":"add test"}]}\n```');
  assert.equal(value.tasks[0].task_id, 'T1');
});

test('Planner output is normalized and bounded', () => {
  const plan = normalizePlan({
    tasks: [
      { task_id: 'T1', title: 'One', objective: 'Implement one', dependencies: [], risk: 'GREEN' },
      { task_id: 'T2', title: 'Two', objective: 'Implement two', dependencies: ['T1'], risk: 'YELLOW' }
    ]
  }, 'goal', 'done', 2);
  assert.equal(plan.schema, 'aecp.plan/v1');
  assert.equal(plan.tasks.length, 2);
  assert.deepEqual(plan.tasks[1].dependencies, ['T1']);
});
