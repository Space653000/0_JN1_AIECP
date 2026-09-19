'use strict';

/**
 * Bounded failure recovery assistant.
 * It never executes arbitrary remediation. It classifies evidence and emits
 * an explicit low-risk recommendation for the Control Plane to apply.
 */
const TRANSIENT_PATTERNS=[
  /timed out/i,/timeout/i,/ECONNRESET/i,/ETIMEDOUT/i,/EAI_AGAIN/i,/rate.?limit/i,
  /temporar(y|ily)/i,/lock.*(busy|held)/i,/resource.*busy/i,/network.*unavailable/i
];
const HUMAN_PATTERNS=[
  /credential/i,/permission denied/i,/access denied/i,/authentication/i,/secret/i,
  /policy/i,/security/i,/merge/i,/delete/i,/production/i
];
function classifyFailure({error='',ciFailure=null,phase='' }={}){
 const text=[error,phase,JSON.stringify(ciFailure||{})].join('
');
 if(HUMAN_PATTERNS.some(r=>r.test(text))) return 'HIGH_RISK_OR_AUTH';
 if(TRANSIENT_PATTERNS.some(r=>r.test(text))) return 'TRANSIENT';
 if(/test|lint|build|compile|assert/i.test(text)) return 'DETERMINISTIC_FAILURE';
 return 'UNKNOWN';
}
function recommend(input={}){
 const category=classifyFailure(input);
 if(category==='TRANSIENT') return {category,action:'RETRY_ONCE',autoEligible:true,maxExtraAttempts:1,reason:'Failure matches a bounded transient pattern.'};
 if(category==='DETERMINISTIC_FAILURE') return {category,action:'REWORK',autoEligible:true,maxExtraAttempts:1,reason:'Failure appears deterministic and should return to the bounded worker loop.'};
 if(category==='HIGH_RISK_OR_AUTH') return {category,action:'HUMAN_REQUIRED',autoEligible:false,maxExtraAttempts:0,reason:'Failure may require credentials, permissions, policy or production authorization.'};
 return {category,action:'HUMAN_REQUIRED',autoEligible:false,maxExtraAttempts:0,reason:'Failure cause is not safely classified.'};
}
module.exports={classifyFailure,recommend};
