'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {SecurityPolicy,ACTIONS,RISK,ORDER}=require('../electron/lib/security-policy.cjs');

test('B04-L11 compromised provider cannot gain unrestricted local control through policy bypass',()=>{
  const policy=new SecurityPolicy({
    allowRoots:['/trusted/workspace'],
    maxRisk:'RED',
    requireApprovalFor:['PUSH','MERGE','DELETE','CREDENTIAL','SYSTEM']
  });
  // Even if a provider claims SYSTEM action, it must be blocked by policy
  const result=policy.check({action:'SYSTEM',path:'/etc/passwd',approved:false});
  assert.equal(result.allowed,false,'SYSTEM action must be denied without approval');
  assert.equal(result.requiresApproval,true,'SYSTEM action must require explicit approval');
});

test('B04-L13 local policy engine is the security boundary, not provider reasoning',()=>{
  const policy=new SecurityPolicy({
    allowRoots:['/workspace'],
    maxRisk:'YELLOW'
  });
  // Test that every provider-to-tool boundary respects the policy engine's decision
  const forbiddenPath='/etc/hosts';
  const result=policy.check({action:'WRITE',path:forbiddenPath});
  assert.equal(result.allowed,false,'Policy engine must deny access outside allowRoots');
  assert(result.reason.includes('outside the configured allowlist'),'Reason must cite policy');
  // Verify that a provider's own permission claim doesn't override this
  const resultWithApproval=policy.check({action:'WRITE',path:forbiddenPath,approved:true});
  // Even with approval, if path is outside allowlist, it should still be denied for WRITE
  // Actually, 'approved' only overrides risk ceiling and requireApprovalFor, not path check
  // So this test verifies that path bounds are enforced independently
  assert.equal(resultWithApproval.allowed,false,'Path bounds are enforced regardless of approval');
});

test('B04-RED-L66 git push/publish operations are classified as RED and require explicit approval',()=>{
  // Test that PUSH, PR, MERGE are classified per risk levels
  assert.equal(RISK['PUSH'],'RED','PUSH is classified RED');
  assert.equal(RISK['PR'],'YELLOW','PR is classified YELLOW');
  assert.equal(RISK['MERGE'],'RED','MERGE is classified RED');

  // Test with maxRisk=RED to allow RED operations but still require approval
  const policy=new SecurityPolicy({
    maxRisk:'RED',
    requireApprovalFor:['PUSH','PR','MERGE']
  });

  const pushCheck=policy.check({action:'PUSH',approved:false});
  assert.equal(pushCheck.requiresApproval,true,'PUSH requires explicit approval');

  const prCheck=policy.check({action:'PR',approved:false});
  assert.equal(prCheck.requiresApproval,true,'PR requires explicit approval');

  const mergeCheck=policy.check({action:'MERGE',approved:false});
  assert.equal(mergeCheck.requiresApproval,true,'MERGE requires explicit approval');
});

test('B04-RED-L66 approval gate must be honored for RED operations',()=>{
  const policy=new SecurityPolicy({requireApprovalFor:['PUSH'],allowRoots:['/workspace']});
  const withoutApproval=policy.check({action:'PUSH',path:'/workspace/repo',approved:false});
  assert.equal(withoutApproval.allowed,false,'PUSH without approval is blocked');

  const withApproval=policy.check({action:'PUSH',path:'/workspace/repo',approved:true});
  assert.equal(withApproval.allowed,true,'PUSH with approval is allowed');
});
