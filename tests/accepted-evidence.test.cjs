'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {acceptedTaskEvidence,validateAcceptedTaskEvidence}=require('../electron/lib/accepted-evidence.cjs');

const fixture=()=>({
  run:{id:'mission-1'},
  task:{id:'task-1',finishedAt:'2026-09-22T00:00:00.000Z',delivery:{sha:'0123456789012345678901234567890123456789'}},
  result:{
    baseHead:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    blueprintVersion:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    providers:{planner:'claude',builder:'codex',reviewer:'claude'},
    models:{planner:'p',builder:'b',reviewer:'r'},
    plan:{plan_id:'plan-1'},
    patch:{sha256:'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',bytes:120,changedFiles:['src/a.js']},
    tasks:[{
      id:'inner-1',
      iterations:2,
      worker:{provider:'codex',model:'b',command:'codex',code:0,timedOut:false,aborted:false,outputLimitExceeded:false},
      verification:{passed:true,command:'npm run verify',code:0,timedOut:false,aborted:false,outputLimitExceeded:false},
      review:{result:'PASS',findings:[],required_changes:[]}
    }]
  }
});

test('accepted-task evidence contains every reproducibility field required by Blueprint 20',()=>{
  const evidence=acceptedTaskEvidence(fixture());
  assert.equal(evidence.schema,'aecp.accepted-task-evidence/v1');
  assert.equal(evidence.taskId,'task-1');
  assert.equal(evidence.runId,'mission-1');
  assert.equal(evidence.blueprintVersion,'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  assert.equal(evidence.planId,'plan-1');
  assert.equal(evidence.agents.builder,'codex');
  assert.equal(evidence.iterationCount,2);
  assert.equal(evidence.baseCommit,'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  assert.equal(evidence.finalCommit,'0123456789012345678901234567890123456789');
  assert.equal(evidence.patch.bytes,120);
  assert.deepEqual(evidence.changedFiles,['src/a.js']);
  assert.deepEqual(evidence.commands.map(x=>[x.phase,x.command,x.exitCode]),[
    ['builder','codex',0],
    ['verifier','npm run verify',0]
  ]);
  assert.equal(evidence.verifierResults[0].passed,true);
  assert.equal(evidence.reviewResults[0].result,'PASS');
  assert.deepEqual(validateAcceptedTaskEvidence(evidence),{ok:true,errors:[]});
});

test('accepted-task evidence validation fails closed on missing verification review or patch hash',()=>{
  const evidence=acceptedTaskEvidence(fixture());
  evidence.verifierResults[0].passed=false;
  evidence.reviewResults[0].result='REWORK';
  evidence.patch.sha256=null;
  const result=validateAcceptedTaskEvidence(evidence);
  assert.equal(result.ok,false);
  assert.ok(result.errors.includes('verifierResults'));
  assert.ok(result.errors.includes('reviewResults'));
  assert.ok(result.errors.includes('patch'));
});

test('Control Plane persists accepted evidence and a SHA manifest before publishing Result Capsule',()=>{
  const source=fs.readFileSync(path.join(__dirname,'..','electron','lib','control-plane.cjs'),'utf8');
  assert.match(source,/acceptedTaskEvidence\(\{run,task,result\}\)/);
  assert.match(source,/validateAcceptedTaskEvidence/);
  assert.match(source,/EVIDENCE_INCOMPLETE/);
  assert.match(source,/task\.acceptedEvidence=await this\.evidence\.write/);
  assert.match(source,/task\.evidenceManifest=await this\.evidence\.manifest/);
  assert.match(source,/type:'harness-record'/);
  assert.match(source,/type:'verified-patch'/);
  assert.match(source,/type:'event-journal'/);
  assert.match(source,/evidence:task\.evidenceManifest\|\|task\.evidence/);
});

test('Harness patch includes SHA-256 and privacy-safe Worker command metadata',()=>{
  const harness=fs.readFileSync(path.join(__dirname,'..','electron','lib','harness.cjs'),'utf8');
  assert.match(harness,/crypto\.createHash\('sha256'\)\.update\(r\.stdout\)/);
  assert.match(harness,/record\.blueprintVersion/);
  assert.match(harness,/command:\s*b\.command\s*\|\|\s*b\.provider/);
  assert.match(harness,/changedFiles/);
});
