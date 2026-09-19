'use strict';

/**
 * Bounded failure recovery assistant.
 * It classifies available evidence and emits a constrained plan. It never
 * executes arbitrary remediation or expands the caller's permissions.
 */

const TRANSIENT_PATTERNS=[
 /timed out/i,/timeout/i,/ECONNRESET/i,/ETIMEDOUT/i,/EAI_AGAIN/i,/rate.?limit/i,
 /temporar(y|ily)/i,/lock.*(busy|held)/i,/resource.*busy/i,/network.*unavailable/i
];
const HUMAN_PATTERNS=[
 /credential/i,/permission denied/i,/access denied/i,/authentication/i,/secret/i,
 /policy/i,/security/i,/merge/i,/delete/i,/production/i
];
const DETERMINISTIC_PATTERNS=[
 /test failed/i,/failing test/i,/lint/i,/build failed/i,/compile/i,/assert/i,
 /syntax error/i,/type error/i,/module not found/i,/command not found/i
];

function evidenceText({error='',phase='',ciFailure=null,evidence=null,logs=''}={}){
 return [error,phase,JSON.stringify(ciFailure||{}),JSON.stringify(evidence||{}),String(logs||'')].join('\n');
}

function classifyFailure(input={}){
 const text=evidenceText(input);
 if(HUMAN_PATTERNS.some(r=>r.test(text)))return 'HIGH_RISK_OR_AUTH';
 if(TRANSIENT_PATTERNS.some(r=>r.test(text)))return 'TRANSIENT';
 if(DETERMINISTIC_PATTERNS.some(r=>r.test(text)) || /test|lint|build|compile|assert/i.test(text))return 'DETERMINISTIC_FAILURE';
 return 'UNKNOWN';
}

function recommendation(category){
 if(category==='TRANSIENT')return {category,action:'RETRY_ONCE',autoEligible:true,maxExtraAttempts:1,reason:'Failure matches a bounded transient pattern.'};
 if(category==='DETERMINISTIC_FAILURE')return {category,action:'REWORK',autoEligible:true,maxExtraAttempts:1,reason:'Failure appears deterministic and should return to the bounded worker loop.'};
 if(category==='HIGH_RISK_OR_AUTH')return {category,action:'HUMAN_REQUIRED',autoEligible:false,maxExtraAttempts:0,reason:'Failure may require credentials, permissions, policy or production authorization.'};
 return {category,action:'HUMAN_REQUIRED',autoEligible:false,maxExtraAttempts:0,reason:'Failure cause is not safely classified.'};
}

function extractSignals(input={}){
 const text=evidenceText(input);
 const signals=[];
 for(const [name,pattern] of [
  ['timeout',/timeout|timed out|ETIMEDOUT/i],
  ['network',/ECONNRESET|EAI_AGAIN|network.*unavailable/i],
  ['rate_limit',/rate.?limit|429/i],
  ['lock_contention',/lock.*(busy|held)|resource.*busy/i],
  ['test_failure',/test failed|failing test|assert/i],
  ['build_failure',/build failed|compile|syntax error|type error/i],
  ['dependency_failure',/module not found|package.*not found|dependency/i],
  ['credential_or_permission',/credential|permission denied|access denied|authentication|secret/i]
 ])if(pattern.test(text))signals.push(name);
 return [...new Set(signals)];
}

function buildRecoveryPlan(input={}){
 const category=classifyFailure(input);
 const base=recommendation(category);
 const signals=extractSignals(input);
 const steps=[];
 if(category==='TRANSIENT'){
  steps.push('Preserve the same task identity, workspace and evidence chain.');
  steps.push('Retry the failed bounded phase once with the existing timeout/policy limits.');
 }else if(category==='DETERMINISTIC_FAILURE'){
  steps.push('Attach the failing test/build evidence to the existing task context.');
  steps.push('Return the same task to the bounded worker rework phase.');
  steps.push('Re-run deterministic verification before any delivery transition.');
 }else{
  steps.push('Preserve evidence and stop autonomous remediation.');
  steps.push('Create or retain a HUMAN_REQUIRED approval/block state.');
 }
 return {
  ...base,
  signals,
  steps,
  authority:'NO_NEW_PERMISSIONS',
  maxTotalAdditionalAttempts:base.maxExtraAttempts,
  evidenceRequired:['failure-classification','recovery-decision'],
  safeToAutoApply:Boolean(base.autoEligible)
 };
}

function recommend(input={}){return buildRecoveryPlan(input);}

module.exports={classifyFailure,recommend,recommendation,extractSignals,buildRecoveryPlan};
