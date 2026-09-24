'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {gitChangedFiles,gitUntrackedFiles,makeWorkerReport,saveWorkerReport}=require('../electron/lib/worker-report.cjs');

test('Worker Report changed files come from Git, never Builder claims',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'aecp-worker-report-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const git=(...args)=>execFileSync('git',args,{cwd:root,windowsHide:true});
  git('init','-q');git('config','user.email','test@aecp.local');git('config','user.name','AECP Test');
  await fs.writeFile(path.join(root,'a.txt'),'before');git('add','.');git('commit','-qm','base');
  await fs.writeFile(path.join(root,'a.txt'),'after');await fs.writeFile(path.join(root,'new.txt'),'new');
  assert.deepEqual(await gitUntrackedFiles(root),['new.txt']);
  const files=await gitChangedFiles(root);
  const report=makeWorkerReport({taskId:'T1',runId:'RUN1',worker:{workerId:'W1',provider:'codex',model:'m',code:0},
    stdout:JSON.stringify({status:'DONE',changed_files:['fake.txt'],response:'SECRET=abcdef123456'}),changedFiles:files});
  assert.deepEqual(report.changed_files,['a.txt','new.txt']);
  assert.equal(report.self_reported_status,'DONE');
  assert.equal(report.completionProof,false);
  assert.equal(report.schema,'aecp.worker-report/v1');
  assert.equal(report.task_id,'T1');assert.equal(report.run_id,'RUN1');
  for(const key of ['agent','iteration','base_commit','commands','tests','result','unresolved','evidence_refs'])assert.ok(Object.hasOwn(report,key));
  assert.doesNotMatch(JSON.stringify(report),/fake.txt|abcdef123456/);
  assert.match(report.summary,/not proof of completion/);
  const saved=await saveWorkerReport(root,report,1);
  assert.equal(saved.sha256.length,64);
  assert.equal(JSON.parse(await fs.readFile(saved.file)).run_id,'RUN1');
});
