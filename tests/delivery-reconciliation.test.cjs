'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {DeliveryManager}=require('../electron/lib/delivery.cjs');

function fakeRunner(responses){
 const calls=[];
 const runner=async(args)=>{
  calls.push(args);
  const key=args.join(' ');
  const handler=responses.find(x=>x.match(key));
  if(!handler)throw new Error('Unexpected command: '+key);
  return handler.run();
 };
 return {runner,calls};
}

test('delivery push reconciles ambiguous command failure by matching remote SHA',async()=>{
 let pushAttempts=0;
 const {runner}=fakeRunner([
  {match:key=>key==='git rev-parse HEAD',run:async()=> 'abc123'},
  {match:key=>key==='git push -u origin agent/task-1',run:async()=>{pushAttempts++;throw Object.assign(new Error('transport disconnected'),{code:'COMMAND_TIMEOUT'});}},
  {match:key=>key==='git ls-remote --heads origin agent/task-1',run:async()=> 'abc123\trefs/heads/agent/task-1'}
 ]);
 const delivery=new DeliveryManager({repo:'Space653000/example',cwd:'C:/repo',runner});
 const result=await delivery.push('C:/worktree','agent/task-1');
 assert.equal(pushAttempts,1);
 assert.match(result,/RECONCILED_REMOTE_PUSH/);
});

test('delivery push still fails when remote SHA does not prove success',async()=>{
 const expected=new Error('push failed before remote accepted it');
 const {runner}=fakeRunner([
  {match:key=>key==='git rev-parse HEAD',run:async()=> 'abc123'},
  {match:key=>key==='git push -u origin agent/task-2',run:async()=>{throw expected;}},
  {match:key=>key==='git ls-remote --heads origin agent/task-2',run:async()=> 'def456\trefs/heads/agent/task-2'}
 ]);
 const delivery=new DeliveryManager({repo:'Space653000/example',cwd:'C:/repo',runner});
 await assert.rejects(()=>delivery.push('C:/worktree','agent/task-2'),/push failed before remote accepted/);
});

test('draft PR reconciles a lost response by discovering the created PR',async()=>{
 let listCalls=0;
 const {runner,calls}=fakeRunner([
  {match:key=>key.startsWith('gh pr list '),run:async()=>{
   listCalls++;
   return listCalls===1?'':'https://github.com/Space653000/example/pull/42';
  }},
  {match:key=>key.startsWith('gh pr create '),run:async()=>{throw Object.assign(new Error('connection closed after server accepted create'),{code:'COMMAND_TIMEOUT'});}}
 ]);
 const delivery=new DeliveryManager({repo:'Space653000/example',cwd:'C:/repo',runner});
 const result=await delivery.draftPR('C:/worktree',{branch:'agent/task-3',title:'AECP task',body:'evidence'});
 assert.equal(result,'https://github.com/Space653000/example/pull/42');
 assert.equal(calls.filter(x=>x[0]==='gh'&&x[1]==='pr'&&x[2]==='create').length,1);
 assert.equal(listCalls,2);
});

test('draft PR never duplicates an already-open PR',async()=>{
 const {runner,calls}=fakeRunner([
  {match:key=>key.startsWith('gh pr list '),run:async()=> 'https://github.com/Space653000/example/pull/7'}
 ]);
 const delivery=new DeliveryManager({repo:'Space653000/example',cwd:'C:/repo',runner});
 const result=await delivery.draftPR('C:/worktree',{branch:'agent/task-4',title:'AECP task'});
 assert.equal(result,'https://github.com/Space653000/example/pull/7');
 assert.equal(calls.some(x=>x[0]==='gh'&&x[1]==='pr'&&x[2]==='create'),false);
});
