'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {verifyEvidence}=require('../scripts/verify-evidence-bundle.cjs');

const sourceCommit='a'.repeat(40);
const hash='b'.repeat(64);
const options={expectSha:sourceCommit,expectMode:'ollama',expectArch:'arm64'};
const sample=()=>({schema:'aecp.provider-environment-evidence/v1',sourceCommit,mode:'ollama',platform:'win32',
  arch:'arm64',expectedArch:'arm64',checks:[{id:'ollama.real-smoke',status:'PASS'}],
  summary:{requested:1,passed:1,failed:0},privacy:{promptBodiesPersisted:false,responseBodiesPersisted:false,credentialsPersisted:false}});
const workflowRun=()=>({repository:'Space653000/0_JN1_AIECP',workflow:'AECP Real Provider Evidence',
  runId:'123456789',runAttempt:'1',sha:sourceCommit});

test('valid provider evidence passes read-only CLI and reports local provenance',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'aecp-evidence-test-'));
  try{
    const file=path.join(root,'evidence.json');
    const original=JSON.stringify(sample());
    fs.writeFileSync(file,original);
    const result=spawnSync(process.execPath,[path.join(__dirname,'..','scripts','verify-evidence-bundle.cjs'),file,
      '--expect-sha',sourceCommit,'--expect-mode','ollama','--expect-arch','arm64'],{encoding:'utf8'});
    assert.equal(result.status,0,result.stdout+result.stderr);
    assert.match(result.stdout,/PROVENANCE: LOCAL_SCRIPT/);
    assert.equal(fs.readFileSync(file,'utf8'),original);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('workflow metadata is only a claimed provenance with a copyable external check',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'aecp-evidence-workflow-'));
  try{
    const file=path.join(root,'evidence.json');
    fs.writeFileSync(file,JSON.stringify({...sample(),workflowRun:workflowRun()}));
    const result=spawnSync(process.execPath,[path.join(__dirname,'..','scripts','verify-evidence-bundle.cjs'),file,
      '--expect-sha',sourceCommit],{encoding:'utf8'});
    assert.equal(result.status,0,result.stdout+result.stderr);
    assert.match(result.stdout,/PROVENANCE: WORKFLOW_CLAIMED/);
    assert.match(result.stdout,/gh run view 123456789 --repo Space653000\/0_JN1_AIECP --json headSha,conclusion,workflowName/);
    assert.match(result.stdout,/headSha.*sourceCommit.*conclusion.*success/);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('workflow SHA contradiction and secret-like metadata fail without printing secrets',()=>{
  const mismatch=sample();mismatch.workflowRun={...workflowRun(),sha:'c'.repeat(40)};
  assert.equal(verifyEvidence(mismatch,options).passed,false);
  const secret=sample();secret.workflowRun={...workflowRun(),workflow:'Bearer abcdefghi123456'};
  const report=verifyEvidence(secret,options);
  assert.equal(report.passed,false);
  assert.ok(report.results.some(item=>item.name==='secret-scan'&&item.status==='FAIL'));
  assert.doesNotMatch(JSON.stringify(report),/Bearer abcdefghi123456/);
});

for(const [name,mutate] of [
  ['SHA mismatch',e=>{e.sourceCommit='c'.repeat(40);}],
  ['architecture mismatch',e=>{e.arch='x64';}],
  ['failed summary',e=>{e.summary.failed=1;}],
  ['privacy true',e=>{e.privacy.credentialsPersisted=true;}],
  ['sk-token',e=>{e.model='sk-abcdefghi123456';}],
  ['Bearer token',e=>{e.model='Bearer abcdefghi123456';}],
  ['duplicate Codex homes',e=>{e.mode='multi-codex';e.checks=[{id:'codex.multi-worker-real-concurrency',status:'PASS',
    workers:[{workerId:'codex-official',model:'fixed',health:'READY',codexHomeSha256:hash},
      {workerId:'codex-pega',model:'fixed',health:'READY',codexHomeSha256:hash}],
    distinctCodexHomes:true,distinctWorktrees:true,distinctProcesses:true}];}],
  ['file verifier mismatch',e=>{e.mode='codex-official';e.checks=[{id:'codex-official.real-smoke',status:'PASS',
    workerId:'codex-official',model:'fixed',health:'READY',codexHomeSha256:hash,
    fileVerifier:{path:'worker_result.txt',sha256:hash,expectedSha256Match:false}}];}]
]){
  test(`${name} fails evidence verification`,()=>{
    const evidence=sample();mutate(evidence);
    assert.equal(verifyEvidence(evidence,{expectSha:sourceCommit,expectArch:'arm64'}).passed,false);
  });
}

test('fault-isolation evidence requires recovery and D1 protections',()=>{
  const evidence=sample();evidence.mode='codex-fault-isolation';
  evidence.checks=[{id:'codex.fault-isolation',status:'PASS',stages:[],protection:{}},{id:'recovery',status:'PASS'}];
  evidence.summary={requested:2,passed:2,failed:0};
  assert.equal(verifyEvidence(evidence,{expectSha:sourceCommit}).passed,false);
});
