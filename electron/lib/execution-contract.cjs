'use strict';

function clean(value,max=4000){
  const s=String(value??'').trim();
  return s?s.slice(0,max):null;
}

function makeExecutionContract(input={}){
  const goal=clean(input.goal,6000);
  const done=clean(input.definitionOfDone??input.done,6000);
  if(!goal)throw new Error('Execution contract requires goal.');
  if(!done)throw new Error('Execution contract requires Definition of Done.');
  const taskIds=Array.isArray(input.taskIds)?[...new Set(input.taskIds.map(x=>clean(x,160)).filter(Boolean))]:[];
  return {
    schema:'aecp.execution-contract/v1',
    goal,
    definitionOfDone:done,
    workspace:{
      id:clean(input.workspaceId,200),
      root:clean(input.workspaceRoot,4096)
    },
    permissionPolicy:input.permissionPolicy&&typeof input.permissionPolicy==='object'?JSON.parse(JSON.stringify(input.permissionPolicy)): {},
    taskIds,
    contextCapsuleRef:clean(input.contextCapsuleRef,4096),
    commandCardRef:clean(input.commandCardRef,4096),
    resultCapsuleRef:clean(input.resultCapsuleRef,4096),
    evidenceRef:clean(input.evidenceRef,4096),
    traceRef:clean(input.traceRef,4096),
    transport:clean(input.transport,120)||'local',
    worker:clean(input.worker,200),
    createdAt:clean(input.createdAt,80)||new Date().toISOString(),
    updatedAt:clean(input.updatedAt,80)||new Date().toISOString()
  };
}

function updateExecutionContract(contract,patch={}){
  if(!contract||contract.schema!=='aecp.execution-contract/v1')throw new Error('Unsupported execution contract.');
  return makeExecutionContract({
    ...contract,
    ...patch,
    workspaceId:patch.workspaceId??contract.workspace?.id,
    workspaceRoot:patch.workspaceRoot??contract.workspace?.root,
    permissionPolicy:patch.permissionPolicy??contract.permissionPolicy,
    taskIds:patch.taskIds??contract.taskIds,
    createdAt:contract.createdAt,
    updatedAt:new Date().toISOString()
  });
}

function validateExecutionContract(contract){
  const errors=[];
  if(contract?.schema!=='aecp.execution-contract/v1')errors.push('schema');
  if(!contract?.goal)errors.push('goal');
  if(!contract?.definitionOfDone)errors.push('definitionOfDone');
  if(!contract?.workspace?.id&&!contract?.workspace?.root)errors.push('workspace');
  if(!contract?.permissionPolicy||typeof contract.permissionPolicy!=='object')errors.push('permissionPolicy');
  if(!Array.isArray(contract?.taskIds))errors.push('taskIds');
  if(!contract?.transport)errors.push('transport');
  return {ok:errors.length===0,errors};
}

module.exports={makeExecutionContract,updateExecutionContract,validateExecutionContract};
