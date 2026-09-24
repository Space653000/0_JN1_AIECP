'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const {redactSensitive,redactText}=require('./redaction.cjs');
const exec=promisify(execFile);

async function gitUntrackedFiles(worktree){
  const {stdout}=await exec('git',['ls-files','--others','--exclude-standard','-z'],{cwd:worktree,windowsHide:true,timeout:30000,maxBuffer:4*1024*1024});
  return String(stdout).split('\0').filter(Boolean).map(name=>redactText(name));
}
async function gitChangedFiles(worktree){
  await exec('git',['add','-N','.'],{cwd:worktree,windowsHide:true,timeout:30000});
  const {stdout}=await exec('git',['diff','--name-only','-z','HEAD'],{cwd:worktree,windowsHide:true,timeout:30000,maxBuffer:4*1024*1024});
  return String(stdout).split('\0').filter(Boolean).map(name=>redactText(name));
}
function makeWorkerReport({taskId,runId,worker,stdout,changedFiles=[],iteration,baseCommit}){
  let selfReported='UNKNOWN';
  try{const parsed=JSON.parse(String(stdout||''));if(['PASS','FAIL','DONE','BLOCKED','UNKNOWN'].includes(parsed?.status))selfReported=parsed.status;}catch{}
  const summary=`Worker process ${worker?.code===0?'exited successfully':'failed'}; ${changedFiles.length} Git changed file(s). This report is not proof of completion; deterministic verifier evidence is authoritative.`;
  return redactSensitive({schema:'aecp.worker-report/v1',task_id:taskId,run_id:runId,
    worker_id:worker?.workerId||'UNKNOWN',provider:worker?.provider||'UNKNOWN',model:worker?.model||'UNKNOWN',
    summary:summary.slice(0,1000),changed_files:changedFiles.slice(0,1000),self_reported_status:selfReported,
    agent:worker?.workerId||worker?.provider||'UNKNOWN',iteration:iteration||null,base_commit:baseCommit||null,
    commands:[worker?.command||worker?.provider||'UNKNOWN'],tests:[],result:worker?.code===0?'PROCESS_EXIT_0':'PROCESS_FAILED',
    unresolved:['Deterministic verification pending'],evidence_refs:[],completionProof:false});
}
async function saveWorkerReport(runRoot,report,iteration){
  const file=path.join(runRoot,`worker-report-${String(report.task_id).replace(/[^a-zA-Z0-9_-]/g,'_')}-${iteration}.json`);
  const body=JSON.stringify(report,null,2)+'\n';
  await fs.mkdir(runRoot,{recursive:true});await fs.writeFile(file,body,'utf8');
  return {file,sha256:crypto.createHash('sha256').update(body).digest('hex')};
}
module.exports={gitChangedFiles,gitUntrackedFiles,makeWorkerReport,saveWorkerReport};
