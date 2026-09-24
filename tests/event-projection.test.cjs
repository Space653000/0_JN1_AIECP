'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { projectEvents } = require('../electron/lib/event-projection.cjs');
const {timeline}=require('../ui/dashboard-projection.js');

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

test('timeline maps immutable event IDs to bounded evidence and remains read-only',()=>{
  const source=[{id:'evt-2',at:'2026-09-24T00:00:02Z',type:'task.event',taskId:'T1',runId:'R1',data:{type:'state.reviewing'},evidence:{file:'events.jsonl',sha256:'a'.repeat(64),summary:'review'}} ,
    {id:'evt-1',at:'2026-09-24T00:00:01Z',type:'task.event',taskId:'T1',runId:'R1',data:{type:'state.running'}}];
  const before=JSON.stringify(source);
  const view=timeline(source,'T1');
  assert.equal(view.state,'AVAILABLE');
  assert.deepEqual(view.entries.map(x=>x.id),['evt-1','evt-2']);
  assert.equal(view.entries[1].evidence.sha256,'a'.repeat(64));
  assert.equal(view.entries[0].evidence.path,'UNKNOWN');
  assert.equal(JSON.stringify(source),before);
});
test('timeline without task or events is UNKNOWN',()=>{
  assert.deepEqual(timeline([],null),{state:'UNKNOWN',entries:[]});
  assert.equal(timeline([],'T1').state,'UNKNOWN');
});
