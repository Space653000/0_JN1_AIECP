'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { projectEvents } = require('../electron/lib/event-projection.cjs');
const {timeline,diffView,reviewView,REVIEW_DIMENSIONS}=require('../ui/dashboard-projection.js');

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
test('Diff projection shows canonical stats or UNKNOWN without changing task state',()=>{
  const task={state:'DONE',result:{patch:{bytes:90},tasks:[{diffStats:{changedFiles:['a.js'],additions:3,deletions:1,
    untrackedFiles:['b.js'],patchBytes:80,baseCommit:'a'.repeat(40),currentCommit:'a'.repeat(40),verifierStatus:'PASS'}}]}};
  const before=JSON.stringify(task),view=diffView(task);
  assert.deepEqual(view.changedFiles,['a.js']);assert.deepEqual(view.untrackedFiles,['b.js']);
  assert.equal(view.patchBytes,90);assert.equal(view.additions,3);assert.equal(view.verifierStatus,'PASS');
  assert.equal(JSON.stringify(task),before);
  assert.equal(diffView(null).state,'UNKNOWN');
  assert.equal(diffView({state:'QUEUED'}).patchBytes,'UNKNOWN');
});
test('Review projection shows six canonical dimensions, human gate and UNKNOWN',()=>{
  const report={schema:'aecp.review/v1',result:'HUMAN_REQUIRED',originalResult:'BLOCKED',
    ...Object.fromEntries(REVIEW_DIMENSIONS.map(d=>[d,'WARN'])),findings:['Decision needed'],required_changes:['Ask owner']};
  const task={result:{tasks:[{review:report}]}};
  const before=JSON.stringify(task),view=reviewView(task);
  assert.equal(view.result,'HUMAN_REQUIRED');assert.equal(view.originalResult,'BLOCKED');
  assert.equal(Object.keys(view.dimensions).length,6);
  assert.deepEqual(view.findings,['Decision needed']);assert.equal(JSON.stringify(task),before);
  assert.equal(reviewView({}).result,'UNKNOWN');
  assert.ok(Object.values(reviewView({}).dimensions).every(v=>v==='UNKNOWN'));
});
