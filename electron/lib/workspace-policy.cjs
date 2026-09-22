'use strict';

const {ACTIONS,RISK}=require('./security-policy.cjs');

const DEFAULT_APPROVAL_ACTIONS=Object.freeze([
  'NETWORK','INSTALL','PUSH','PR','MERGE','DELETE','CREDENTIAL','SYSTEM'
]);
const ALWAYS_APPROVAL_ACTIONS=Object.freeze(['PUSH','MERGE','DELETE','CREDENTIAL','SYSTEM']);

function normalizeWorkspacePolicy(input={}){
  const maxRisk=['GREEN','YELLOW'].includes(input?.maxRisk)?input.maxRisk:'YELLOW';
  const source=Array.isArray(input?.requireApprovalFor)?input.requireApprovalFor:DEFAULT_APPROVAL_ACTIONS;
  const allowed=new Set(Object.keys(ACTIONS));
  const approvals=new Set(source.map(String).filter(x=>allowed.has(x)));
  for(const action of ALWAYS_APPROVAL_ACTIONS) approvals.add(action);
  return {
    schema:'aecp.workspace-policy/v1',
    maxRisk,
    requireApprovalFor:[...approvals].sort(),
    updatedAt:typeof input?.updatedAt==='string'?input.updatedAt:null
  };
}

function compileWorkspacePolicy(input={}){
  const normalized=normalizeWorkspacePolicy(input);
  return {
    maxRisk:normalized.maxRisk,
    requireApprovalFor:normalized.requireApprovalFor
  };
}

function editableActions(){
  return Object.keys(ACTIONS).map(action=>({
    action,
    risk:RISK[action],
    alwaysApproval:ALWAYS_APPROVAL_ACTIONS.includes(action)
  }));
}

module.exports={DEFAULT_APPROVAL_ACTIONS,ALWAYS_APPROVAL_ACTIONS,normalizeWorkspacePolicy,compileWorkspacePolicy,editableActions};
