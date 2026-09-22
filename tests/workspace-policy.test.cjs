'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {SecurityPolicy}=require('../electron/lib/security-policy.cjs');
const {
  DEFAULT_APPROVAL_ACTIONS,
  ALWAYS_APPROVAL_ACTIONS,
  normalizeWorkspacePolicy,
  compileWorkspacePolicy,
  editableActions
}=require('../electron/lib/workspace-policy.cjs');

const root=path.resolve(__dirname,'..');
const read=(file)=>fs.readFileSync(path.join(root,file),'utf8');

test('Recommended Workspace policy preserves bounded local execution defaults',()=>{
  const policy=normalizeWorkspacePolicy({});
  assert.equal(policy.maxRisk,'YELLOW');
  assert.deepEqual(policy.requireApprovalFor,[...DEFAULT_APPROVAL_ACTIONS].sort());
  assert.equal(policy.requireApprovalFor.includes('WRITE'),false);
  assert.equal(policy.requireApprovalFor.includes('EXECUTE'),false);
  assert.equal(policy.requireApprovalFor.includes('COMMIT'),false);
  const runtime=new SecurityPolicy({allowRoots:['C:\\work'],...compileWorkspacePolicy(policy)});
  assert.equal(runtime.check({action:'WRITE',path:'C:\\work\\file.txt'}).allowed,true);
  assert.equal(runtime.check({action:'EXECUTE',path:'C:\\work'}).allowed,true);
});

test('Workspace policy can require approval for reversible YELLOW capabilities',()=>{
  const policy=normalizeWorkspacePolicy({
    maxRisk:'YELLOW',
    requireApprovalFor:['WRITE','EXECUTE','COMMIT']
  });
  const runtime=new SecurityPolicy({allowRoots:['C:\\work'],...compileWorkspacePolicy(policy)});
  for(const action of ['WRITE','EXECUTE','COMMIT']){
    const denied=runtime.check({action,path:'C:\\work'});
    assert.equal(denied.allowed,false);
    assert.equal(denied.requiresApproval,true);
    assert.equal(runtime.check({action,path:'C:\\work',approved:true}).allowed,true);
  }
});

test('RED capability approvals cannot be removed by the policy editor model',()=>{
  const policy=normalizeWorkspacePolicy({requireApprovalFor:[]});
  for(const action of ALWAYS_APPROVAL_ACTIONS) assert.ok(policy.requireApprovalFor.includes(action),action);
  const actions=editableActions();
  for(const action of ALWAYS_APPROVAL_ACTIONS){
    assert.equal(actions.find(item=>item.action===action)?.alwaysApproval,true,action);
  }
});

test('Workspace policy rejects a RED automatic risk ceiling',()=>{
  const policy=normalizeWorkspacePolicy({maxRisk:'RED'});
  assert.equal(policy.maxRisk,'YELLOW');
});

test('main process persists Workspace policy and applies it to Harness and Control Plane',()=>{
  const main=read('electron/main.cjs');
  const control=read('electron/lib/control-plane.cjs');
  assert.match(main,/policy:save/);
  assert.match(main,/normalizeWorkspacePolicy/);
  assert.match(main,/compileWorkspacePolicy\(workspace\.policy \|\| \{\}\)/);
  assert.match(main,/controlPlane\?\.setPolicyConfig\(next\)/);
  assert.match(control,/policyConfig=compileWorkspacePolicy\(policyConfig\)/);
  assert.match(control,/new SecurityPolicy\(\{allowRoots:\[\.\.\.new Set\(roots\)\],\.\.\.this\.policyConfig\}\)/);
});

test('Engineering Settings exposes canonical policy and a read-only adapter capability matrix',()=>{
  const html=read('ui/index.html');
  const app=read('ui/app.js');
  const preload=read('electron/preload.cjs');
  assert.match(html,/Workspace Policy/);
  assert.match(html,/Adapter Capability Matrix/);
  assert.match(app,/data-policy-action/);
  assert.match(app,/renderPolicySettings/);
  assert.match(app,/renderAdapterMatrix/);
  assert.match(app,/saveWorkspacePolicySettings/);
  assert.match(app,/always requires approval/);
  assert.match(preload,/getWorkspacePolicy/);
  assert.match(preload,/saveWorkspacePolicy/);
  assert.match(preload,/getAdapterCapabilityMatrix/);
  assert.doesNotMatch(app,/adapterMatrix[^\n]{0,120}(?:save|write|grant)/i);
});
