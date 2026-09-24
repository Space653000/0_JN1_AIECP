'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { projectEvents } = require('../electron/lib/event-projection.cjs');

test('event projection materializes run task approval and type counters deterministically', () => {
  const projection = projectEvents([
    { at: '2026-09-22T00:00:00.000Z', type: 'mission.created', runId: 'r1' },
    { at: '2026-09-22T00:00:01.000Z', type: 'task.queued', runId: 'r1', taskId: 't1' },
    { at: '2026-09-22T00:00:02.000Z', type: 'approval.requested', runId: 'r1', taskId: 't1', approvalId: 'a1' },
    { at: '2026-09-22T00:00:03.000Z', type: 'approval.approved', runId: 'r1', taskId: 't1', approvalId: 'a1' }
  ]);
  assert.equal(projection.total, 4);
  assert.equal(projection.runs.r1.eventCount, 4);
  assert.equal(projection.tasks.t1.eventCount, 3);
  assert.equal(projection.approvals.a1.eventCount, 2);
  assert.equal(projection.byType['approval.approved'], 1);
  assert.equal(projection.latestAt, '2026-09-22T00:00:03.000Z');
});
