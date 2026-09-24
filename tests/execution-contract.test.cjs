'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {
  makeExecutionContract,
  updateExecutionContract,
  validateExecutionContract
}=require('../electron/lib/execution-contract.cjs');

const root=path.resolve(__dirname,'..');
const read=(file)=>fs.readFileSync(path.join(root,file),'utf8');

test('canonical execution contract normalizes the transport-independent task envelope',()=>{
  const value=makeExecutionContract({
    goal:'Implement feature safely.',
    done:'Tests pass with evidence.',
    workspaceId:'ws-1',
    workspaceRoot:'C:\\work',
    permissionPolicy:{mode:'FULL_HARNESS',maxRisk:'YELLOW'},
    taskIds:['T1','T1','T2'],
    contextCapsuleRef:'local://context/1',
    commandCardRef:'local://command/1',
    resultCapsuleRef:'local://result/1',
    evidenceRef:'local://evidence/1',
    traceRef:'local://trace/1',
    transport:'full-harness',
    worker:'codex'
  });
  assert.equal(value.schema,'aecp.execution-contract/v1');
  assert.equal(value.goal,'Implement feature safely.');
  assert.equal(value.definitionOfDone,'Tests pass with evidence.');
  assert.deepEqual(value.workspace,{id:'ws-1',root:'C:\\work'});
  assert.deepEqual(value.taskIds,['T1','T2']);
  assert.equal(value.permissionPolicy.maxRisk,'YELLOW');
  assert.deepEqual(validateExecutionContract(value),{ok:true,errors:[]});
});

test('execution contract update preserves Workspace and creation identity while changing evidence refs',()=>{
  const initial=makeExecutionContract({
    goal:'Goal',
    done:'Done criteria',
    workspaceId:'ws-1',
    workspaceRoot:'C:\\work',
    permissionPolicy:{mode:'WEB_SAFE_BRIDGE'},
    taskIds:['T1'],
    transport:'web-safe-bridge',
    worker:'fixed-read-only-adapter',
    createdAt:'2026-09-22T00:00:00.000Z'
  });
  const next=updateExecutionContract(initial,{
    evidenceRef:'local://evidence/T1/evidence.json',
    traceRef:'local://evidence/T1/trace.jsonl'
  });
  assert.equal(next.createdAt,initial.createdAt);
  assert.deepEqual(next.workspace,initial.workspace);
  assert.equal(next.evidenceRef,'local://evidence/T1/evidence.json');
  assert.equal(next.traceRef,'local://evidence/T1/trace.jsonl');
});

test('execution contract validation fails closed on missing portable fields',()=>{
  const result=validateExecutionContract({
    schema:'aecp.execution-contract/v1',
    goal:'',
    definitionOfDone:'',
    workspace:{id:null,root:null},
    permissionPolicy:null,
    taskIds:null,
    transport:''
  });
  assert.equal(result.ok,false);
  for(const field of ['goal','definitionOfDone','workspace','permissionPolicy','taskIds','transport']){
    assert.ok(result.errors.includes(field),field);
  }
});

test('Safe Bridge Autonomy Harness and Control Plane all persist the same execution-contract schema',()=>{
  const main=read('electron/main.cjs');
  const autonomy=read('electron/lib/autonomy.cjs');
  const harness=read('electron/lib/harness.cjs');
  const control=read('electron/lib/control-plane.cjs');

  assert.match(main,/schema:\s*'aecp\.task\/v1'[\s\S]*executionContract:\s*makeExecutionContract/);
  assert.match(main,/transport:\s*'web-safe-bridge'/);
  assert.match(main,/transport:\s*'local-autonomous'/);
  assert.match(autonomy,/executionContract:\s*incomingContract/);
  assert.match(harness,/record\.executionContract\s*=\s*suppliedExecutionContract\s*\|\|\s*makeExecutionContract/);
  assert.match(harness,/transport:\s*'full-harness'/);
  assert.match(control,/executionContract=makeExecutionContract/);
  assert.match(control,/task\.executionContract=task\.executionContract\|\|makeExecutionContract/);
  assert.match(control,/transport:'control-plane-harness'/);
});

test('cross-mode contracts keep Workspace and policy boundaries explicit rather than changing permission by transport',()=>{
  const main=read('electron/main.cjs');
  const control=read('electron/lib/control-plane.cjs');
  assert.match(main,/workspaceId:\s*workspace\.id/);
  assert.match(main,/workspaceRoot:\s*workspace\.rootPath/);
  assert.match(main,/compileWorkspacePolicy\(workspace\.policy \|\| \{\}\)/);
  assert.match(main,/highRisk:\s*'HUMAN_REQUIRED'/);
  assert.match(control,/permissionPolicy:\{mode:'CONTROL_PLANE_MISSION',\.\.\.this\.policyConfig,highRisk:'HUMAN_REQUIRED'\}/);
  assert.match(control,/workspaceId:run\.workspaceId/);
});
