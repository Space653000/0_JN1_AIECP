'use strict';

const {canonicalForCompare,isNetworkPath,isWithinRoot}=require('./path-safety.cjs');

const ACTIONS=Object.freeze({READ:'READ',TEST:'TEST',WRITE:'WRITE',EXECUTE:'EXECUTE',NETWORK:'NETWORK',INSTALL:'INSTALL',COMMIT:'COMMIT',PUSH:'PUSH',PR:'PR',MERGE:'MERGE',DELETE:'DELETE',CREDENTIAL:'CREDENTIAL',SYSTEM:'SYSTEM'});
const RISK=Object.freeze({READ:'GREEN',TEST:'GREEN',WRITE:'YELLOW',EXECUTE:'YELLOW',NETWORK:'YELLOW',INSTALL:'YELLOW',COMMIT:'YELLOW',PUSH:'RED',PR:'YELLOW',MERGE:'RED',DELETE:'RED',CREDENTIAL:'RED',SYSTEM:'RED'});
const ORDER=Object.freeze({GREEN:0,YELLOW:1,RED:2});
const normalizeRisk=r=>['GREEN','YELLOW','RED'].includes(r)?r:'RED';

class SecurityPolicy{
 constructor(o={}){
  this.allowRoots=(o.allowRoots||[]).map(canonicalForCompare);
  this.allowNetworkPaths=Boolean(o.allowNetworkPaths);
  this.maxRisk=normalizeRisk(o.maxRisk||'YELLOW');
  this.requireApprovalFor=new Set(o.requireApprovalFor||['NETWORK','INSTALL','PUSH','PR','MERGE','DELETE','CREDENTIAL','SYSTEM']);
 }
 classify(a){return RISK[a]||'RED';}
 check({action,path='',approved=false}={}){
  const risk=this.classify(action),r={allowed:false,action,risk,requiresApproval:false,reason:''};
  if(!ACTIONS[action]){r.reason='Unknown action.';return r;}
  if(ORDER[risk]>ORDER[this.maxRisk]&&!approved){
   r.requiresApproval=true;r.reason='Risk exceeds policy ceiling.';return r;
  }
  if(this.requireApprovalFor.has(action)&&!approved){
   r.requiresApproval=true;r.reason='Human approval required by policy.';return r;
  }
  if(path){
   if(isNetworkPath(path)&&!this.allowNetworkPaths){r.reason='UNC/network paths are disabled by policy.';return r;}
   const inside=this.allowRoots.some(root=>isWithinRoot(root,path));
   if(!inside){r.reason='Path is outside the configured allowlist.';return r;}
  }
  r.allowed=true;r.reason='Policy permits action.';return r;
 }
 assert(input){const r=this.check(input);if(!r.allowed)throw Object.assign(new Error(r.reason),{code:r.requiresApproval?'APPROVAL_REQUIRED':'POLICY_DENIED',policy:r});return r;}
}
module.exports={SecurityPolicy,ACTIONS,RISK,ORDER};
