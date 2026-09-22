'use strict';

function acceptedTaskEvidence({run={},task={},result={}}={}){
  const innerTasks=Array.isArray(result.tasks)?result.tasks:[];
  const commands=[];
  for(const item of innerTasks){
    if(item?.worker){
      commands.push({
        phase:'builder',
        taskId:item.id||null,
        provider:item.worker.provider||result.providers?.builder||null,
        model:item.worker.model||result.models?.builder||null,
        command:item.worker.command||null,
        exitCode:Number.isInteger(item.worker.code)?item.worker.code:null,
        timedOut:Boolean(item.worker.timedOut),
        aborted:Boolean(item.worker.aborted),
        outputLimitExceeded:Boolean(item.worker.outputLimitExceeded)
      });
    }
    if(item?.verification){
      commands.push({
        phase:'verifier',
        taskId:item.id||null,
        provider:'deterministic-local',
        model:null,
        command:item.verification.command||null,
        exitCode:Number.isInteger(item.verification.code)?item.verification.code:null,
        timedOut:Boolean(item.verification.timedOut),
        aborted:Boolean(item.verification.aborted),
        outputLimitExceeded:Boolean(item.verification.outputLimitExceeded)
      });
    }
  }

  const changedFiles=Array.isArray(result.patch?.changedFiles)?[...result.patch.changedFiles]:[];
  return {
    schema:'aecp.accepted-task-evidence/v1',
    runId:run.id||null,
    taskId:task.id||null,
    blueprintVersion:result.blueprintVersion||result.baseHead||null,
    planId:result.plan?.plan_id||null,
    agents:{...(result.providers||{})},
    models:{...(result.models||{})},
    iterationCount:innerTasks.reduce((sum,item)=>sum+Math.max(0,Number(item?.iterations||0)),0),
    baseCommit:result.baseHead||null,
    finalCommit:task.delivery?.sha||null,
    patch:result.patch?{
      sha256:result.patch.sha256||null,
      bytes:Number(result.patch.bytes||0),
      changedFiles
    }:null,
    commands,
    verifierResults:innerTasks.map(item=>({
      taskId:item.id||null,
      passed:Boolean(item.verification?.passed),
      command:item.verification?.command||null,
      exitCode:Number.isInteger(item.verification?.code)?item.verification.code:null
    })),
    reviewResults:innerTasks.map(item=>({
      taskId:item.id||null,
      result:item.review?.result||null,
      findings:Array.isArray(item.review?.findings)?item.review.findings:[],
      requiredChanges:Array.isArray(item.review?.required_changes)?item.review.required_changes:[]
    })),
    changedFiles,
    completedAt:result.updatedAt||result.finishedAt||task.finishedAt||null
  };
}

function validateAcceptedTaskEvidence(value){
  const errors=[];
  if(value?.schema!=='aecp.accepted-task-evidence/v1')errors.push('schema');
  for(const key of ['runId','taskId','blueprintVersion','planId','baseCommit']) if(!value?.[key])errors.push(key);
  if(!value?.agents?.planner||!value?.agents?.builder||!value?.agents?.reviewer)errors.push('agents');
  if(!Array.isArray(value?.commands)||!value.commands.some(x=>x.phase==='builder')||!value.commands.some(x=>x.phase==='verifier'))errors.push('commands');
  if(!Array.isArray(value?.verifierResults)||!value.verifierResults.length||value.verifierResults.some(x=>!x.passed))errors.push('verifierResults');
  if(!Array.isArray(value?.reviewResults)||!value.reviewResults.length||value.reviewResults.some(x=>x.result!=='PASS'))errors.push('reviewResults');
  if(!value?.patch?.sha256||!Array.isArray(value?.patch?.changedFiles))errors.push('patch');
  return {ok:errors.length===0,errors};
}

module.exports={acceptedTaskEvidence,validateAcceptedTaskEvidence};
