'use strict';

const ACTIVE=new Set(['PLANNING','QUEUED','RUNNING','VERIFYING','REVIEWING','REWORK']);
const NEEDS_HUMAN=new Set(['HUMAN_REQUIRED','WAITING_USER']);

function recommendNextAction({hasWorkspace=false,tasks=[],approvals=[],chatgptOpened=false,harnessState=null}={}){
  if(!hasWorkspace)return{action:'CHOOSE_WORKSPACE',label:'Choose Workspace',detail:'Select the local folder boundary AECP may use.'};
  const waitingApproval=(approvals||[]).find(x=>x?.state==='WAITING');
  const humanTask=(tasks||[]).find(x=>NEEDS_HUMAN.has(x?.state));
  if(waitingApproval||humanTask)return{action:'REVIEW_APPROVAL',label:'Review approval',detail:'A governed action is waiting for your decision.',taskId:humanTask?.id||waitingApproval?.taskId||null};
  if(ACTIVE.has(harnessState))return{action:'WATCH_ACTIVE_WORK',label:'Watch active work',detail:'A bounded Harness run is active. Review progress, evidence, or stop it if needed.'};
  const ready=(tasks||[]).find(x=>x?.state==='READY');
  if(ready)return{action:'RUN_TASK',label:'Run ready task',detail:'A local task is ready for governed execution.',taskId:ready.id};
  const done=(tasks||[]).find(x=>x?.state==='DONE');
  if(done)return{action:'REVIEW_EVIDENCE',label:'Review evidence',detail:'Verified local work is available for review.',taskId:done.id};
  if(!chatgptOpened)return{action:'OPEN_CHATGPT',label:'Open ChatGPT',detail:'Open the official ChatGPT surface for supervision or task drafting.'};
  if(!(tasks||[]).length)return{action:'CREATE_SAFE_SAMPLE_OR_GOAL',label:'Create work',detail:'Run a safe local check or define a Goal Loop.'};
  return{action:'CREATE_GOAL',label:'Define a Goal Loop',detail:'No task needs attention. Define a measurable Goal and Definition of Done.'};
}

module.exports={recommendNextAction};
