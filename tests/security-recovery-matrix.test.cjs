'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {audit,DEFAULT_ADAPTERS}=require('../electron/lib/adapter-security-audit.cjs');
const {SecurityPolicy}=require('../electron/lib/security-policy.cjs');
const {buildRecoveryPlan}=require('../electron/lib/failure-recovery.cjs');

test('adapter security matrix has an explicit decision for every capability',()=>{
 const result=audit();
 assert.equal(result.ok,true);
 assert.equal(result.adapters.length,DEFAULT_ADAPTERS.length);
 for(const adapter of result.adapters){
  for(const capability of result.capabilities)assert.ok(adapter.capabilities[capability]);
 }
});

test('workspace write is policy-governed but does not force a human gate',()=>{
 const policy=new SecurityPolicy({allowRoots:['C:\\work'],maxRisk:'YELLOW'});
 const result=policy.check({action:'WRITE',path:'C:\\work\\repo'});
 assert.equal(result.allowed,true);
 assert.equal(result.requiresApproval,false);
 assert.equal(policy.check({action:'EXECUTE',path:'C:\\work\\repo'}).allowed,true);
 assert.equal(policy.check({action:'PUSH',path:'C:\\work\\repo'}).requiresApproval,true);
});

test('recovery plan preserves evidence and never expands permissions',()=>{
 const plan=buildRecoveryPlan({phase:'CI',ciFailure:[{conclusion:'failure',name:'CI'}],logs:'test failed: expected 1 got 2'});
 assert.equal(plan.category,'DETERMINISTIC_FAILURE');
 assert.equal(plan.safeToAutoApply,true);
 assert.equal(plan.authority,'NO_NEW_PERMISSIONS');
 assert.ok(plan.steps.length>=2);
 assert.ok(plan.evidenceRequired.includes('recovery-decision'));
});

test('credential and permission failures stop autonomous recovery',()=>{
 const plan=buildRecoveryPlan({error:'permission denied while reading credential'});
 assert.equal(plan.category,'HIGH_RISK_OR_AUTH');
 assert.equal(plan.safeToAutoApply,false);
 assert.equal(plan.action,'HUMAN_REQUIRED');
});


test('policy rejects lexical traversal and sibling-prefix escapes',()=>{
 const policy=new SecurityPolicy({allowRoots:['C:\\work'],maxRisk:'YELLOW'});
 assert.equal(policy.check({action:'READ',path:'C:\\work\\..\\outside\\secret.txt'}).allowed,false);
 assert.equal(policy.check({action:'READ',path:'C:\\work-evil\\secret.txt'}).allowed,false);
 assert.equal(policy.check({action:'READ',path:'C:\\work\\safe\\file.txt'}).allowed,true);
});

test('UNC paths are denied by default and require explicit network-path policy',()=>{
 const unc='\\\\server\\share';
 const denied=new SecurityPolicy({allowRoots:[unc],maxRisk:'YELLOW'});
 const deniedResult=denied.check({action:'READ',path:'\\\\server\\share\\file.txt'});
 assert.equal(deniedResult.allowed,false);
 assert.match(deniedResult.reason,/UNC\/network paths are disabled/);

 const allowed=new SecurityPolicy({allowRoots:[unc],allowNetworkPaths:true,maxRisk:'YELLOW'});
 assert.equal(allowed.check({action:'READ',path:'\\\\server\\share\\file.txt'}).allowed,true);
 assert.equal(allowed.check({action:'READ',path:'\\\\server\\other\\file.txt'}).allowed,false);
});
