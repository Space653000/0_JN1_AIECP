'use strict';
const crypto=require('node:crypto');
const fs=require('node:fs/promises');
const path=require('node:path');
const {redactSensitive}=require('./redaction.cjs');
const DIMENSIONS=['blueprint','plan','implementation','tests','security','architecture'];
const RESULTS=new Set(['PASS','REWORK','BLOCKED','HUMAN_REQUIRED']);
const GRADES=new Set(['PASS','WARN','FAIL']);

function parseStrict(raw){
  try{
    let value=JSON.parse(String(raw||''));
    if(value&&typeof value==='object'&&typeof value.result==='string'&&!RESULTS.has(value.result)){
      // CLI envelopes use `result` for their JSON-string payload.
      try{value=JSON.parse(value.result);}catch{}
    }
    return value;
  }catch{return null;}
}
function validateReviewReport(raw,{taskId,runId,reviewer,verifierPassed}={}){
  const value=parseStrict(raw);
  const errors=[];
  if(!value||typeof value!=='object'||Array.isArray(value))errors.push('Reviewer returned non-JSON or non-object data.');
  else{
    if(value.schema!=='aecp.review/v1')errors.push('Missing or unsupported review schema.');
    if(value.task_id!==taskId||value.run_id!==runId)errors.push('Task/Run correlation mismatch.');
    if(!value.reviewer||typeof value.reviewer.provider!=='string'||typeof value.reviewer.model!=='string')errors.push('Reviewer provider/model missing.');
    if(reviewer&&value.reviewer?.provider!==reviewer.provider)errors.push('Reviewer provider mismatch.');
    if(!RESULTS.has(value.result))errors.push('Unknown review result.');
    for(const dimension of DIMENSIONS)if(!GRADES.has(value[dimension]))errors.push(`Missing or invalid ${dimension} grade.`);
    if(!Array.isArray(value.findings)||!value.findings.every(x=>typeof x==='string'))errors.push('findings must be string array.');
    if(!Array.isArray(value.required_changes)||!value.required_changes.every(x=>typeof x==='string'))errors.push('required_changes must be string array.');
  }
  const report=redactSensitive({schema:'aecp.review/v1',task_id:taskId,run_id:runId,
    reviewer:{provider:reviewer?.provider||'UNKNOWN',model:reviewer?.model||'UNKNOWN'},
    result:errors.length?'HUMAN_REQUIRED':value.result,
    ...Object.fromEntries(DIMENSIONS.map(d=>[d,errors.length?'WARN':value[d]])),
    findings:errors.length?errors:(value.findings||[]),required_changes:errors.length?[]:(value.required_changes||[])});
  if(!errors.length){
    if(value.result==='BLOCKED'){
      report.originalResult='BLOCKED';report.result='HUMAN_REQUIRED';
      report.findings.push('Reviewer BLOCKED: human decision required.');
    }else if(value.result==='PASS'&&DIMENSIONS.some(d=>value[d]==='FAIL')){
      report.result='REWORK';report.findings.push('Contradiction: PASS claimed with FAIL dimension.');
    }
    if(!verifierPassed&&report.result==='PASS'){
      report.result='REWORK';report.findings.push('Deterministic verifier did not pass.');
    }
  }
  return {report,valid:errors.length===0,errors};
}
async function saveReviewReport(runRoot,report,iteration){
  const file=path.join(runRoot,`review-report-${String(report.task_id).replace(/[^a-zA-Z0-9_-]/g,'_')}-${iteration}.json`);
  const data=JSON.stringify(redactSensitive(report),null,2)+'\n';
  await fs.mkdir(runRoot,{recursive:true});await fs.writeFile(file,data,'utf8');
  return {file,sha256:crypto.createHash('sha256').update(data).digest('hex')};
}
module.exports={DIMENSIONS,validateReviewReport,saveReviewReport};
