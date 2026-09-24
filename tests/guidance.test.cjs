'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {recommendNextAction}=require('../electron/lib/guidance.cjs');

test('guidance prioritizes workspace and human approval boundaries',()=>{
 assert.equal(recommendNextAction({}).action,'CHOOSE_WORKSPACE');
 assert.equal(recommendNextAction({hasWorkspace:true,approvals:[{state:'WAITING',taskId:'T1'}]}).action,'REVIEW_APPROVAL');
});

test('guidance prioritizes active and ready work before creating more work',()=>{
 assert.equal(recommendNextAction({hasWorkspace:true,harnessState:'RUNNING'}).action,'WATCH_ACTIVE_WORK');
 const result=recommendNextAction({hasWorkspace:true,tasks:[{id:'T2',state:'READY'}],chatgptOpened:true});
 assert.equal(result.action,'RUN_TASK');
 assert.equal(result.taskId,'T2');
});

test('guidance surfaces evidence before suggesting a new goal',()=>{
 const result=recommendNextAction({hasWorkspace:true,tasks:[{id:'T3',state:'DONE'}],chatgptOpened:true});
 assert.equal(result.action,'REVIEW_EVIDENCE');
 assert.equal(result.taskId,'T3');
});
